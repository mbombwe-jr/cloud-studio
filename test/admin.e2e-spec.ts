import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  createAccount, createApp, createStaff, prisma, request, admin, truncateAll,
  apiKeyHeader, mockCollection, mockPayout, waitFor,
} from './helpers';

describe('Admin oversight, billing & security (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let servicemanToken: string;
  let acc: Awaited<ReturnType<typeof createAccount>>;

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await truncateAll(app);
    adminToken = (await createStaff(app, 'ADMIN')).token;
    servicemanToken = (await createStaff(app, 'SERVICEMAN')).token;
    acc = await createAccount(app, adminToken, {
      services: {
        COLLECTION: { granted: true, meta: { channels: ['MOBILE_MONEY'] } },
        DISBURSEMENT: { granted: true, meta: { channels: ['MOBILE_MONEY'] } },
        SMS: { granted: true },
      },
      fundCollectionWallet: '50000',
      fundDisbursementWallet: '50000',
    });
    mockCollection(app).defaultCollectionStatus = 'SUCCESS';
    mockPayout(app).defaultPayoutStatus = 'SUCCESS';
  });

  afterAll(async () => {
    await app.close();
  });

  it('admin creates servicemen who log in with strictly read-only access', async () => {
    const create = await request(app).post('/admin/users').set(admin(adminToken)).send({
      name: 'Ops Watcher', email: `watcher-${Date.now()}@zoostudios.test`, password: 'WatchOnly2026x', role: 'SERVICEMAN',
    });
    expect(create.status).toBe(201);
    expect(create.body.data.role).toBe('SERVICEMAN');

    const login = await request(app).post('/auth/login').send({ email: create.body.data.email, password: 'WatchOnly2026x' });
    expect(login.status).toBe(200);
    const watchToken = login.body.data.accessToken;

    // read: allowed
    const overview = await request(app).get(`/admin/accounts/${acc.id}/overview`).set(admin(watchToken));
    expect(overview.status).toBe(200);
    // write: forbidden
    const suspend = await request(app).post(`/admin/accounts/${acc.id}/suspend`).set(admin(watchToken)).send({ suspendReason: 'nope' });
    expect(suspend.status).toBe(403);
    const deposit = await request(app).post(`/admin/accounts/${acc.id}/wallets/COLLECTION/deposit`).set(admin(watchToken)).send({ amount: '1000', reason: 'nope' });
    expect(deposit.status).toBe(403);
  });

  it('overview previews transactions, sms, wallets, bills, api keys and audit trail', async () => {
    mockCollection(app).defaultCollectionStatus = 'SUCCESS';
    await request(app).post('/collections/ussd-push').set(apiKeyHeader(acc.apiKey)).send({ amount: '1000', phoneNumber: '255712345678' });
    const overview = await request(app).get(`/admin/accounts/${acc.id}/overview`).set(admin(adminToken));
    expect(overview.status).toBe(200);
    const body = overview.body.data;
    expect(body.account.accountName).toBe(acc.accountName);
    expect(body.account.wallets).toHaveLength(2);
    expect(body.collections).toHaveLength(1);
    expect(body.audits.length).toBeGreaterThan(0);
  });

  it('computational review covers current month (default), day and custom ranges with ledger reconciliation', async () => {
    const init = await request(app).post('/collections/ussd-push').set(apiKeyHeader(acc.apiKey)).send({ amount: '12000', phoneNumber: '255712345678' });
    await request(app).post('/webhooks/clickpesa').send({
      event: 'PAYMENT RECEIVED',
      data: { id: 'TX-COMP-1', status: 'SUCCESS', orderReference: init.body.data.reference, collectedAmount: '12000', collectedCurrency: 'TZS' },
    });
    await request(app).post('/disbursements/mobile-money').set(apiKeyHeader(acc.apiKey)).send({ amount: '4000', phoneNumber: '255712345679' });
    await waitFor(async () => {
      const payouts = await prisma(app).payout.findMany({ where: { accountId: acc.id } });
      return payouts.every((p) => p.status === 'SUCCESS');
    }, 8000);

    const month = await request(app).get(`/admin/accounts/${acc.id}/computations`).set(admin(adminToken));
    expect(month.status).toBe(200);
    const c = month.body.data;
    expect(c.collection.totalCount).toBe(1);
    expect(Number(c.collection.totalAmount)).toBe(12000);
    expect(c.disbursement.totalCount).toBe(1);
    expect(c.ratios.netFlow).toBe('8000.00');
    expect(c.wallets).toHaveLength(2);
    const collectionWallet = c.wallets.find((w: any) => w.walletType === 'COLLECTION');
    expect(collectionWallet.ledgerConsistent).toBe(true);
    expect(Number(collectionWallet.openingBalance)).toBe(0);
    expect(Number(collectionWallet.closingBalance)).toBe(61760); // 50000 funding + 12000 gross - 240 fee

    const day = await request(app).get(`/admin/accounts/${acc.id}/computations?preset=day`).set(admin(adminToken));
    expect(day.body.data.collection.totalCount).toBe(1);

    const today = new Date().toISOString().slice(0, 10);
    const custom = await request(app).get(`/admin/accounts/${acc.id}/computations?preset=custom&from=${today}&to=${today}`).set(admin(adminToken));
    expect(custom.body.data.collection.totalCount).toBe(1);

    const badRange = await request(app).get('/admin/accounts/nonexistent/computations').set(admin(adminToken));
    expect(badRange.status).toBe(404);
    expect(badRange.body.error.code).toBe('NOT_FOUND');
  });

  it('plans and bills: assign plan, manual bills, no auto-suspension for unpaid bills', async () => {
    const plan = await request(app).post('/admin/plans').set(admin(adminToken)).send({
      name: 'Starter TZ', services: ['COLLECTION', 'SMS'], recurringAmount: '75000', periodDays: 30,
    });
    expect(plan.status).toBe(201);

    const assign = await request(app).post(`/admin/accounts/${acc.id}/plan`).set(admin(adminToken)).send({ planId: plan.body.data.id });
    expect(assign.status).toBe(201);
    expect(Number(assign.body.data.recurringAmount)).toBe(75000);

    const manual = await request(app).post(`/admin/accounts/${acc.id}/bills`).set(admin(adminToken)).send({
      type: 'MANUAL', title: 'Onboarding fee', amount: '150000',
    });
    expect(manual.status).toBe(201);

    const bills = await request(app).get(`/admin/accounts/${acc.id}/bills`).set(admin(adminToken));
    expect(bills.body.data.length).toBe(2);

    // unpaid bills do NOT suspend the account (spec: no automatic suspension)
    const me = await request(app).get('/me').set(apiKeyHeader(acc.apiKey));
    expect(me.status).toBe(200);
  });

  it('audit logs are queryable with filters', async () => {
    await request(app).post(`/admin/accounts/${acc.id}/wallets/COLLECTION/deposit`).set(admin(adminToken)).send({ amount: '1000', reason: 'audit probe' });
    expect(await waitFor(async () =>
      (await prisma(app).auditLog.count({ where: { accountId: acc.id } })) > 0,
    )).toBe(true);
    const res = await request(app).get(`/admin/audit-logs?accountId=${acc.id}`).set(admin(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('analytics summary aggregates tracked events', async () => {
    await request(app).post('/collections/ussd-push').set(apiKeyHeader(acc.apiKey)).send({ amount: '1000', phoneNumber: '255712345678' });
    expect(await waitFor(async () =>
      (await prisma(app).analyticsEvent.count({ where: { accountId: acc.id, name: 'collection.initiated' } })) > 0,
    )).toBe(true);
    const res = await request(app).get('/admin/analytics/summary').set(admin(adminToken));
    expect(res.status).toBe(200);
    const names = res.body.data.summary.map((s: any) => s.event);
    expect(names).toContain('collection.initiated');
  });

  it('traces: full provider request/response snapshots preserved per reference (nothing lost)', async () => {
    const init = await request(app).post('/collections/ussd-push').set(apiKeyHeader(acc.apiKey)).send({ amount: '3000', phoneNumber: '255712345678' });
    const reference = init.body.data.reference;

    expect(await waitFor(async () => {
      const spans = await prisma(app).traceSpan.count({ where: { operation: 'collection.initiate' } });
      return spans > 0;
    })).toBe(true);

    const res = await request(app).get(`/admin/traces?reference=${reference}`).set(admin(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    const initiateSpan = res.body.data.find((s: any) => s.operation === 'collection.initiate');
    expect(initiateSpan).toBeTruthy();
    const events = initiateSpan.events as any[];
    expect(events.some((e) => e.name === 'initiate-request')).toBe(true);

    // servicemen can inspect traces too
    const sm = await request(app).get(`/admin/traces?reference=${reference}`).set(admin(servicemanToken));
    expect(sm.status).toBe(200);
  });

  it('security: service not granted / channel not allowed / bad API key shape / validation errors', async () => {
    // account without SMS permission cannot call /sms
    const noSms = await createAccount(app, adminToken, { services: { COLLECTION: { granted: true } } });
    const res = await request(app).post('/sms/send').set(apiKeyHeader(noSms.apiKey)).send({
      message: 'x', recipients: ['0712345678'],
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SERVICE_NOT_GRANTED');

    // channel not allowed: DISBURSEMENT granted only for MOBILE_MONEY
    const mmOnly = await createAccount(app, adminToken, {
      services: { DISBURSEMENT: { granted: true, meta: { channels: ['MOBILE_MONEY'] } } },
      fundDisbursementWallet: '5000',
    });
    const bank = await request(app).post('/disbursements/bank').set(apiKeyHeader(mmOnly.apiKey)).send({
      amount: '1000', accountNumber: '011222333', accountName: 'Jane Supplier', bic: 'NMIBTZTZ',
    });
    expect(bank.status).toBe(403);
    expect(bank.body.error.code).toBe('CHANNEL_NOT_ALLOWED');

    // too-short key rejected before any lookup
    const shortKey = await request(app).get('/me').set(apiKeyHeader('short-key'));
    expect(shortKey.status).toBe(401);

    // forbidNonWhitelisted: unknown fields are rejected
    const bad = await request(app).post('/admin/accounts').set(admin(adminToken)).send({ accountName: 'X Corp', hackerField: true });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');

    // phone validation
    const badPhone = await request(app).post('/collections/ussd-push').set(apiKeyHeader(acc.apiKey)).send({ amount: '1000', phoneNumber: '12345' });
    expect(badPhone.status).toBe(400);

    // unknown account id -> 404 envelope
    const missing = await request(app).get('/admin/accounts/ACC-ZZZZZZZZ').set(admin(adminToken));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('webhook endpoints: create requires valid URL and events, list + delete work', async () => {
    const bad = await request(app).post('/me/webhooks').set(apiKeyHeader(acc.apiKey)).send({ url: 'not a url with spaces', events: ['SMS_STATUS'] });
    expect(bad.status).toBe(400);

    const create = await request(app).post('/me/webhooks').set(apiKeyHeader(acc.apiKey)).send({
      url: 'http://127.0.0.1:9/callback', events: ['COLLECTION_STATUS', 'SMS_STATUS'],
    });
    expect(create.status).toBe(201);
    expect(create.body.data.secret).toMatch(/^whsec_/);

    const list = await request(app).get('/me/webhooks').set(apiKeyHeader(acc.apiKey));
    expect(list.body.data).toHaveLength(1);

    const del = await request(app).delete(`/me/webhooks/${create.body.data.id}`).set(apiKeyHeader(acc.apiKey));
    expect(del.status).toBe(200);
  });
});
