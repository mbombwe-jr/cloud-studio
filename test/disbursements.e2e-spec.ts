import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  createAccount, createApp, createStaff, prisma, request, admin, truncateAll,
  apiKeyHeader, mockPayout, waitFor, startWebhookCapture,
} from './helpers';

describe('Disbursements (e2e)', () => {
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
      services: { DISBURSEMENT: { granted: true, meta: { channels: ['MOBILE_MONEY', 'BANK'] } } },
      fundDisbursementWallet: '100000',
    });
    mockPayout(app).defaultPayoutStatus = 'SUCCESS';
    mockPayout(app).payoutStatuses.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('mobile money payout: wallet debited atomically, provider called, status finalized', async () => {
    const res = await request(app)
      .post('/disbursements/mobile-money')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '25000', phoneNumber: '255712345678', reference: 'PAY1' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.reference).toHaveLength(20);
    expect(res.body.data.reference.startsWith(acc.sourceCode)).toBe(true);

    // wallet debited immediately at request time (amount + 2% fee = 25500)
    const wallet = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'DISBURSEMENT' } });
    expect(Number(wallet!.balance)).toBe(74500); // 100000 - (25000 + 500 fee)
    const payoutRow = await prisma(app).payout.findUnique({ where: { reference: res.body.data.reference } });
    expect(Number(payoutRow!.feeAmount)).toBe(500);
    expect(payoutRow!.feeBps).toBe(200);

    // queue processes the provider call
    expect(await waitFor(async () => {
      const fresh = await prisma(app).payout.findUnique({ where: { reference: res.body.data.reference } });
      return fresh?.status === 'SUCCESS';
    })).toBe(true);
  });

  it('bank payout uses the Zoostudios payload contract (currency + accountCurrency + bic)', async () => {
    const res = await request(app)
      .post('/disbursements/bank')
      .set(apiKeyHeader(acc.apiKey))
      .send({
        amount: '40000',
        accountNumber: '0676544740',
        accountName: 'DEOGRATIUS DENIS MBOMBWE',
        bic: 'ACTZTZTZ',
      });
    expect(res.status).toBe(201);
    expect(await waitFor(async () => {
      const fresh = await prisma(app).payout.findUnique({ where: { reference: res.body.data.reference } });
      return fresh?.status === 'SUCCESS';
    })).toBe(true);
    const payout = await prisma(app).payout.findUnique({ where: { reference: res.body.data.reference } });
    expect(payout!.bic).toBe('ACTZTZTZ');
    expect(payout!.accountNumber).toBe('0676544740');
  });

  it('failed provider payouts are refunded to the wallet exactly once', async () => {
    // the mock fails numbers ending in 0000
    const res = await request(app)
      .post('/disbursements/mobile-money')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '15000', phoneNumber: '255700000000' });
    expect(res.status).toBe(201);
    expect(await waitFor(async () => {
      const fresh = await prisma(app).payout.findUnique({ where: { reference: res.body.data.reference } });
      return fresh?.status === 'FAILED';
    })).toBe(true);

    const wallet = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'DISBURSEMENT' } });
    expect(Number(wallet!.balance)).toBe(100000); // debited (amount+fee) then fully refunded
    const ledger = await prisma(app).walletTransaction.findMany({
      where: { walletId: wallet!.id },
      orderBy: { createdAt: 'asc' },
    });
    const types = ledger.map((t) => t.type);
    expect(types).toEqual(['DEPOSIT', 'PAYOUT_DEBIT', 'REFUND']);
    expect(Number(ledger[1].amount)).toBe(-15300); // amount + 2% fee
    expect(Number(ledger[2].amount)).toBe(15300); // full debit returned
    const sum = ledger.reduce((s, t) => s + Number(t.amount), 0);
    expect(sum).toBe(100000); // deposit - debit + refund = back to 100000
  });

  it('batch disbursement holds the total, processes items via queue, refunds failures, finalizes status', async () => {
    const capture = await startWebhookCapture(200);
    await request(app).post('/me/webhooks').set(apiKeyHeader(acc.apiKey)).send({
      url: capture.url,
      events: ['BATCH_STATUS', 'DISBURSEMENT_STATUS'],
    });

    const res = await request(app)
      .post('/disbursements/batches')
      .set(apiKeyHeader(acc.apiKey))
      .send({
        name: 'Staff salaries W1',
        items: [
          { channel: 'MOBILE_MONEY', amount: '10000', phoneNumber: '255712345678' },
          { channel: 'MOBILE_MONEY', amount: '20000', phoneNumber: '255750000000' }, // ends 0000 -> fails
          { channel: 'BANK', amount: '30000', accountNumber: '011222333', accountName: 'Jane Supplier', bic: 'NMIBTZTZ' },
        ],
      });
    expect(res.status).toBe(201);
    const batch = res.body.data;
    expect(batch.status).toBe('PROCESSING');
    expect(batch.totalCount).toBe(3);
    expect(Number(batch.totalAmount)).toBe(60000);

    // full total held at creation
    const walletAfterHold = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'DISBURSEMENT' } });
    expect(Number(walletAfterHold!.balance)).toBe(40000);

    expect(await waitFor(async () => {
      const fresh = await prisma(app).disbursementBatch.findUnique({ where: { id: batch.id } });
      return fresh?.status === 'PARTIALLY_FAILED';
    })).toBe(true);

    const finalized = await prisma(app).disbursementBatch.findUnique({ where: { id: batch.id } });
    expect(finalized!.successCount).toBe(2);
    expect(finalized!.failedCount).toBe(1);

    const wallet = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'DISBURSEMENT' } });
    expect(Number(wallet!.balance)).toBe(60000); // 100000 - 60000 hold + 20000 refund

    // batch + payout callbacks delivered
    expect(await waitFor(async () => capture.captured.filter((c) => c.headers['x-zoo-event'] === 'BATCH_STATUS').length >= 1)).toBe(true);
    capture.close();
  });

  it('refuses batch when the wallet cannot cover the full total (no partial holds)', async () => {
    const res = await request(app)
      .post('/disbursements/batches')
      .set(apiKeyHeader(acc.apiKey))
      .send({
        name: 'Too big',
        items: [
          { channel: 'MOBILE_MONEY', amount: '90000', phoneNumber: '255712345678' },
          { channel: 'MOBILE_MONEY', amount: '90000', phoneNumber: '255712345679' },
        ],
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
    const batchCount = await prisma(app).disbursementBatch.count({ where: { accountId: acc.id } });
    expect(batchCount).toBe(0);
  });

  it('duplicate client references are rejected', async () => {
    await request(app).post('/disbursements/mobile-money').set(apiKeyHeader(acc.apiKey)).send({ amount: '1000', phoneNumber: '255712345678', reference: 'DUPX' });
    const res = await request(app).post('/disbursements/mobile-money').set(apiKeyHeader(acc.apiKey)).send({ amount: '1000', phoneNumber: '255712345678', reference: 'DUPX' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_REFERENCE');
  });

  it('payout queries: by reference, list, batch detail', async () => {
    const create = await request(app)
      .post('/disbursements/mobile-money')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '5000', phoneNumber: '255712345678' });
    const reference = create.body.data.reference;
    await waitFor(async () => {
      const fresh = await prisma(app).payout.findUnique({ where: { reference } });
      return fresh?.status === 'SUCCESS';
    });

    const one = await request(app).get(`/disbursements/${reference}`).set(apiKeyHeader(acc.apiKey));
    expect(one.status).toBe(200);
    expect(one.body.data.reference).toBe(reference);

    const list = await request(app).get('/disbursements?status=SUCCESS').set(apiKeyHeader(acc.apiKey));
    expect(list.body.data).toHaveLength(1);

    const batches = await request(app).get('/disbursements/batches').set(apiKeyHeader(acc.apiKey));
    expect(batches.body.data).toHaveLength(0);
  });

  it('outgoing webhook payloads are HMAC-signed with the endpoint secret', async () => {
    const capture = await startWebhookCapture(200);
    const ep = await request(app).post('/me/webhooks').set(apiKeyHeader(acc.apiKey)).send({
      url: capture.url,
      events: ['DISBURSEMENT_STATUS'],
    });
    const secret = ep.body.data.secret as string;

    const create = await request(app)
      .post('/disbursements/mobile-money')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '5000', phoneNumber: '255712345678' });
    await waitFor(async () => capture.captured.length >= 1);

    const { createHmac } = require('crypto');
    const delivered = capture.captured.find((c) => c.headers['x-zoo-event'] === 'DISBURSEMENT_STATUS');
    expect(delivered).toBeTruthy();
    const expectedSig = `sha256=${createHmac('sha256', secret).update(delivered!.body).digest('hex')}`;
    expect(delivered!.headers['x-zoo-signature']).toBe(expectedSig);
    capture.close();
  });
});
