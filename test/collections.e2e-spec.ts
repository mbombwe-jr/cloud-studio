import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  createAccount, createApp, createStaff, prisma, request, admin, truncateAll,
  apiKeyHeader, mockCollection, waitFor, startWebhookCapture,
} from './helpers';

describe('Collections (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let acc: Awaited<ReturnType<typeof createAccount>>;

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await truncateAll(app);
    adminToken = (await createStaff(app, 'ADMIN')).token;
    acc = await createAccount(app, adminToken, {
      services: { COLLECTION: { granted: true, meta: { channels: ['MOBILE_MONEY'] } } },
    });
    mockCollection(app).defaultCollectionStatus = 'PROCESSING';
    mockCollection(app).collectionStatuses.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('preview returns active mobile money methods without creating a transaction', async () => {
    const res = await request(app)
      .post('/collections/ussd-push/preview')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '10000', phoneNumber: '255712345678' });
    expect(res.status).toBe(201);
    expect(res.body.data.activeMethods.length).toBeGreaterThan(0);
    expect(res.body.data.activeMethods[0].status).toBe('AVAILABLE');
    const count = await prisma(app).collection.count({ where: { accountId: acc.id } });
    expect(count).toBe(0);
  });

  it('initiates a USSD push and stores the provider response with a 20-char reference', async () => {
    const res = await request(app)
      .post('/collections/ussd-push')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '25000', phoneNumber: '255712345678', reference: 'ORDER99' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PROCESSING');
    expect(res.body.data.reference).toHaveLength(20);
    expect(res.body.data.reference.startsWith(acc.sourceCode)).toBe(true);
    expect(res.body.data.providerTxId).toContain('MOCKPAY');
  });

  it('rejects duplicate client references (idempotency)', async () => {
    await request(app).post('/collections/ussd-push').set(apiKeyHeader(acc.apiKey)).send({ amount: '1000', phoneNumber: '255712345678', reference: 'DUP1' });
    const res = await request(app).post('/collections/ussd-push').set(apiKeyHeader(acc.apiKey)).send({ amount: '1000', phoneNumber: '255712345678', reference: 'DUP1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_REFERENCE');
  });

  it('webhook callback finalizes the collection, credits the wallet once and notifies the account', async () => {
    const capture = await startWebhookCapture(200);
    // register webhook endpoint for the account
    await request(app)
      .post('/me/webhooks')
      .set(apiKeyHeader(acc.apiKey))
      .send({ url: capture.url, events: ['COLLECTION_STATUS'] });

    const init = await request(app)
      .post('/collections/ussd-push')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '12000', phoneNumber: '255712345678' });
    const reference = init.body.data.reference;

    // provider posts the payment received webhook
    const hook = await request(app)
      .post('/webhooks/clickpesa')
      .send({
        event: 'PAYMENT RECEIVED',
        data: {
          id: 'PROVIDER-TX-1',
          status: 'SUCCESS',
          orderReference: reference,
          paymentReference: 'prov-ref-1',
          collectedAmount: '12000',
          collectedCurrency: 'TZS',
          message: 'success',
          customer: { customerName: 'Jane Doe', customerPhoneNumber: '255712345678' },
        },
      });
    expect(hook.status).toBe(200);

    // collection finalized
    const fetched = await request(app).get(`/collections/${reference}`).set(apiKeyHeader(acc.apiKey));
    expect(fetched.body.data.status).toBe('SUCCESS');
    expect(fetched.body.data.walletCreditedAt).toBeTruthy();

    // wallet credited exactly once
    // fee-aware credit: 12000 gross at/above threshold -> 2% (240) -> net 11760
    const wallet = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'COLLECTION' } });
    expect(Number(wallet!.balance)).toBe(11760);
    const credits = await prisma(app).walletTransaction.findMany({ where: { walletId: wallet!.id, type: 'COLLECTION_CREDIT' } });
    expect(credits).toHaveLength(1);
    const collectionRow = await prisma(app).collection.findUnique({ where: { reference } });
    expect(Number(collectionRow!.feeAmount)).toBe(240);
    expect(collectionRow!.feeBps).toBe(200);

    // re-delivery of the same webhook must not double-credit
    await request(app).post('/webhooks/clickpesa').send({
      event: 'PAYMENT RECEIVED',
      data: { id: 'PROVIDER-TX-1', status: 'SUCCESS', orderReference: reference, collectedAmount: '12000' },
    });
    const walletAgain = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'COLLECTION' } });
    expect(Number(walletAgain!.balance)).toBe(11760);

    // account callback delivered and signed
    expect(await waitFor(async () => capture.captured.length >= 1)).toBe(true);
    const delivered = capture.captured[0];
    expect(delivered.headers['x-zoo-event']).toBe('COLLECTION_STATUS');
    expect(delivered.headers['x-zoo-reference']).toBe(reference);
    const payload = JSON.parse(delivered.body);
    expect(payload.data.status).toBe('SUCCESS');
    capture.close();
  });

  it('failed payment webhooks mark the collection FAILED without crediting the wallet', async () => {
    const init = await request(app)
      .post('/collections/ussd-push')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '5000', phoneNumber: '255712345678' });
    const reference = init.body.data.reference;
    await request(app).post('/webhooks/clickpesa').send({
      event: 'PAYMENT FAILED',
      data: { status: 'FAILED', orderReference: reference, message: 'Insufficient balance' },
    });
    const fetched = await request(app).get(`/collections/${reference}`).set(apiKeyHeader(acc.apiKey));
    expect(fetched.body.data.status).toBe('FAILED');
    const wallet = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'COLLECTION' } });
    expect(Number(wallet!.balance)).toBe(0);
  });

  it('unknown webhook references are acknowledged without error (no probing surface)', async () => {
    const res = await request(app).post('/webhooks/clickpesa').send({
      event: 'PAYMENT RECEIVED',
      data: { status: 'SUCCESS', orderReference: 'ZZZZZDOESNOTEXIST' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.received).toBe(true);
  });

  it('client-triggered status refresh re-queries the provider', async () => {
    mockCollection(app).defaultCollectionStatus = 'SUCCESS';
    const init = await request(app)
      .post('/collections/ussd-push')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '7000', phoneNumber: '255712345678' });
    const reference = init.body.data.reference;
    const refreshed = await request(app).post(`/collections/${reference}/refresh`).set(apiKeyHeader(acc.apiKey));
    expect(refreshed.body.data.status).toBe('SUCCESS');
    // fee-aware: 7000 at/above threshold -> 2% (140) -> net 6860
    const wallet = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'COLLECTION' } });
    expect(Number(wallet!.balance)).toBe(6860);
  });

  it('collection history is paginated with filters', async () => {
    mockCollection(app).defaultCollectionStatus = 'SUCCESS';
    for (let i = 0; i < 3; i++) {
      await request(app).post('/collections/ussd-push').set(apiKeyHeader(acc.apiKey)).send({ amount: '1000', phoneNumber: '255712345678' });
    }
    const res = await request(app).get('/collections?limit=2').set(apiKeyHeader(acc.apiKey));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.pagination.total).toBe(3);
  });
});
