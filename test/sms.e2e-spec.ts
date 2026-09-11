import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  createAccount, createApp, createStaff, prisma, request, admin, truncateAll,
  apiKeyHeader, mockSms, waitFor, startWebhookCapture,
} from './helpers';

describe('SMS (e2e)', () => {
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
      services: { SMS: { granted: true, meta: { payAsYouGo: false } } },
    });
    mockSms(app).smsFailNext = false;
  });

  afterAll(async () => {
    await app.close();
  });

  async function addDedicatedSender(name: string) {
    await prisma(app).senderName.create({ data: { accountId: acc.id, name, type: 'DEDICATED' } });
  }

  it('sends SMS with the platform default shared sender and stores the full history', async () => {
    const res = await request(app)
      .post('/sms/send')
      .set(apiKeyHeader(acc.apiKey))
      .send({ message: 'Your order has shipped!', recipients: ['0712345678', '+255712345679', '255712345680'] });
    expect(res.status).toBe(201);
    expect(res.body.data.senderName).toBe('ZOOINFO');
    expect(res.body.data.recipientCount).toBe(3); // deduped & normalized
    expect(res.body.data.status).toBe('QUEUED');
    expect(res.body.data.reference).toHaveLength(20);
    expect(res.body.data.reference.startsWith(acc.sourceCode)).toBe(true);

    expect(await waitFor(async () => {
      const fresh = await prisma(app).smsMessage.findUnique({ where: { reference: res.body.data.reference } });
      return fresh?.status === 'SENT';
    })).toBe(true);
    const sent = await prisma(app).smsMessage.findUnique({ where: { reference: res.body.data.reference } });
    expect(sent!.providerRequestId).toContain('mockreq');
  });

  it('uses an approved dedicated sender name and rejects unapproved ones', async () => {
    await addDedicatedSender('ACMEALERT');
    const ok = await request(app)
      .post('/sms/send')
      .set(apiKeyHeader(acc.apiKey))
      .send({ senderName: 'ACMEALERT', message: 'Hello from Acme', recipients: ['0712345678'] });
    expect(ok.status).toBe(201);
    expect(ok.body.data.senderName).toBe('ACMEALERT');

    const denied = await request(app)
      .post('/sms/send')
      .set(apiKeyHeader(acc.apiKey))
      .send({ senderName: 'NOTMINE', message: 'nope', recipients: ['0712345678'] });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('INVALID_SENDER');
  });

  it('lists dedicated + shared sender names for the account', async () => {
    await addDedicatedSender('ACMEALERT');
    await prisma(app).senderName.create({ data: { accountId: null, name: 'ZOOSHARED', type: 'SHARED' } });
    const res = await request(app).get('/sms/sender-names').set(apiKeyHeader(acc.apiKey));
    expect(res.status).toBe(200);
    expect(res.body.data.dedicated.map((s: any) => s.name)).toContain('ACMEALERT');
    expect(res.body.data.shared.map((s: any) => s.name)).toContain('ZOOSHARED');
  });

  it('pay-as-you-go accounts get an automatic bill per send', async () => {
    await request(app)
      .put(`/admin/accounts/${acc.id}/permissions`)
      .set(admin(adminToken))
      .send({ permissions: [{ service: 'SMS', granted: true, meta: { payAsYouGo: true } }] });

    const res = await request(app)
      .post('/sms/send')
      .set(apiKeyHeader(acc.apiKey))
      .send({ message: 'PAYG message', recipients: ['0712345678', '0712345679', '0712345670'] });
    expect(res.status).toBe(201);

    expect(await waitFor(async () =>
      (await prisma(app).bill.findFirst({ where: { accountId: acc.id, type: 'PAY_AS_YOU_GO' } })) !== null,
    )).toBe(true);
    const bill = await prisma(app).bill.findFirst({ where: { accountId: acc.id, type: 'PAY_AS_YOU_GO' } });
    expect(Number(bill!.amount)).toBe(60); // 3 recipients x 20 TZS
  });

  it('delivery reports (provider webhook) update status to DELIVERED', async () => {
    const res = await request(app)
      .post('/sms/send')
      .set(apiKeyHeader(acc.apiKey))
      .send({ message: 'DLR test', recipients: ['0712345678'] });
    const reference = res.body.data.reference;
    await waitFor(async () => {
      const fresh = await prisma(app).smsMessage.findUnique({ where: { reference } });
      return fresh?.status === 'SENT';
    });

    const dlr = await request(app).post('/webhooks/beem').send({
      request_id: (await prisma(app).smsMessage.findUnique({ where: { reference } }))!.providerRequestId,
      dest_addr: '255712345678',
      status: 'DELIVERED',
    });
    expect(dlr.status).toBe(200);

    const updated = await prisma(app).smsMessage.findUnique({ where: { reference } });
    expect(updated!.status).toBe('DELIVERED');
  });

  it('provider failures are retried through the queue and eventually succeed or fail visibly', async () => {
    mockSms(app).smsFailNext = true;
    const res = await request(app)
      .post('/sms/send')
      .set(apiKeyHeader(acc.apiKey))
      .send({ message: 'retry me', recipients: ['0712345678'] });
    expect(res.status).toBe(201);
    expect(await waitFor(async () => {
      const fresh = await prisma(app).smsMessage.findUnique({ where: { reference: res.body.data.reference } });
      return fresh?.status === 'SENT'; // first retry succeeds (only next send fails once)
    }, 8000)).toBe(true);
  });

  it('SMS account callback receives SMS_STATUS events', async () => {
    const capture = await startWebhookCapture(200);
    await request(app).post('/me/webhooks').set(apiKeyHeader(acc.apiKey)).send({
      url: capture.url,
      events: ['SMS_STATUS'],
    });
    await request(app).post('/sms/send').set(apiKeyHeader(acc.apiKey)).send({ message: 'callback test', recipients: ['0712345678'] });
    expect(await waitFor(async () => capture.captured.filter((c) => c.headers['x-zoo-event'] === 'SMS_STATUS').length >= 1)).toBe(true);
    capture.close();
  });
});
