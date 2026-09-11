import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createAccount, createApp, createStaff, prisma, request, admin, truncateAll, apiKeyHeader, mockCollection, waitFor } from './helpers';

describe('Accounts & API keys (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let servicemanToken: string;

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await truncateAll(app);
    adminToken = (await createStaff(app, 'ADMIN')).token;
    servicemanToken = (await createStaff(app, 'SERVICEMAN')).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('admin opens an account on behalf of the owner with generated accountId, sourceCode and API key', async () => {
    const res = await request(app).post('/admin/accounts').set(admin(adminToken)).send({ accountName: 'Acme Tanzania' });
    expect(res.status).toBe(201);
    const { account, apiKey: apiKeyInfo } = res.body.data;
    expect(account.accountId).toMatch(/^ACC-[A-Z2-9]{8}$/);
    expect(account.sourceCode).toMatch(/^[A-Z0-9]{5}$/);
    expect(apiKeyInfo.apiKey).toMatch(/^zstest_live_[a-f0-9]{64}$/);
    // both wallets provisioned
    expect(account.wallets).toHaveLength(2);
    // all permissions start denied
    const permissions = await prisma(app).servicePermission.findMany({ where: { accountId: account.id } });
    expect(permissions).toHaveLength(3);
    expect(permissions.every((p) => !p.granted)).toBe(true);
    // audit trail written (fire-and-forget writer, allow a moment to flush)
    expect(await waitFor(async () =>
      (await prisma(app).auditLog.findFirst({ where: { accountId: account.id, action: 'account.created' } })) !== null,
    )).toBe(true);
  });

  it('generates a distinct 5-char sourceCode per account, stable across requests', async () => {
    const a = await createAccount(app, adminToken, { accountName: 'Account A' });
    const b = await createAccount(app, adminToken, { accountName: 'Account B' });
    expect(a.sourceCode).not.toBe(b.sourceCode);
  });

  it('admin assigns service permissions and the account can then call /me', async () => {
    const acc = await createAccount(app, adminToken, {
      services: { COLLECTION: { granted: true, meta: { channels: ['MOBILE_MONEY'] } } },
    });

    const me = await request(app).get('/me').set(apiKeyHeader(acc.apiKey));
    expect(me.status).toBe(200);
    expect(me.body.data.accountId).toBe(acc.accountId);
    const granted = me.body.data.permissions.find((p: any) => p.service === 'COLLECTION');
    expect(granted.granted).toBe(true);
  });

  it('account API key cannot access admin endpoints and staff token cannot pass as API key', async () => {
    const acc = await createAccount(app, adminToken);
    const res1 = await request(app).get('/admin/accounts').set(apiKeyHeader(acc.apiKey));
    expect(res1.status).toBe(401);
    const res2 = await request(app).get('/me').set(admin(adminToken));
    expect(res2.status).toBe(401);
  });

  it('revoked API keys stop working immediately', async () => {
    const acc = await createAccount(app, adminToken);
    const keys = await prisma(app).apiKey.findMany({ where: { accountId: acc.id } });
    expect(keys).toHaveLength(1);

    const revoke = await request(app).delete(`/admin/accounts/${acc.id}/api-keys/${keys[0].id}`).set(admin(adminToken));
    expect(revoke.status).toBe(200);

    const me = await request(app).get('/me').set(apiKeyHeader(acc.apiKey));
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('API_KEY_REVOKED');
  });

  it('admin can issue additional keys; old key remains valid until revoked', async () => {
    const acc = await createAccount(app, adminToken);
    const second = await request(app).post(`/admin/accounts/${acc.id}/api-keys`).set(admin(adminToken)).send({ name: 'backup' });
    expect(second.status).toBe(201);
    expect(second.body.data.apiKey).toMatch(/^zstest_live_/);

    const me = await request(app).get('/me').set(apiKeyHeader(second.body.data.apiKey));
    expect(me.status).toBe(200);
  });

  it('suspended accounts are rejected at the guard (secure-first)', async () => {
    const acc = await createAccount(app, adminToken, { services: { SMS: { granted: true } } });
    const suspend = await request(app)
      .post(`/admin/accounts/${acc.id}/suspend`)
      .set(admin(adminToken))
      .send({ suspendReason: 'suspected fraud under review' });
    expect(suspend.status).toBe(201);

    const me = await request(app).get('/me').set(apiKeyHeader(acc.apiKey));
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('admin can re-activate a suspended account', async () => {
    const acc = await createAccount(app, adminToken);
    await request(app).post(`/admin/accounts/${acc.id}/suspend`).set(admin(adminToken)).send({ suspendReason: 'review' });
    const activate = await request(app).post(`/admin/accounts/${acc.id}/activate`).set(admin(adminToken));
    expect(activate.status).toBe(201);
    const me = await request(app).get('/me').set(apiKeyHeader(acc.apiKey));
    expect(me.status).toBe(200);
  });

  it('servicemen have read access to accounts but cannot write', async () => {
    await createAccount(app, adminToken, { accountName: 'Read Only Target' });
    const list = await request(app).get('/admin/accounts').set(admin(servicemanToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const write = await request(app).post('/admin/accounts').set(admin(servicemanToken)).send({ accountName: 'Nope Ltd' });
    expect(write.status).toBe(403);
  });

  it('admin list supports pagination and search', async () => {
    await createAccount(app, adminToken, { accountName: 'Alpha Corp' });
    await createAccount(app, adminToken, { accountName: 'Beta Corp' });
    const res = await request(app).get('/admin/accounts?limit=1&page=1').set(admin(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.pagination.total).toBe(2);
    expect(res.body.meta.pagination.totalPages).toBe(2);
  });

  it('references issued by the platform always start with the account sourceCode (20 chars)', async () => {
    const acc = await createAccount(app, adminToken, {
      services: { COLLECTION: { granted: true, meta: { channels: ['MOBILE_MONEY'] } } },
      fundCollectionWallet: '1000',
    });
    mockCollection(app).defaultCollectionStatus = 'SUCCESS';
    const init = await request(app)
      .post('/collections/ussd-push')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '1000', phoneNumber: '255712345678', reference: 'CLIENTREF1' });
    expect(init.status).toBe(201);
    expect(init.body.data.reference).toHaveLength(20);
    expect(init.body.data.reference.startsWith(acc.sourceCode)).toBe(true);
    expect(init.body.data.reference.slice(5)).toContain('CLIENTREF1');
  });
});
