import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createAccount, createApp, createStaff, prisma, request, admin, truncateAll, apiKeyHeader } from './helpers';

describe('Wallets (e2e)', () => {
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
      services: { COLLECTION: { granted: true }, DISBURSEMENT: { granted: true } },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('accounts start with two wallets (COLLECTION & DISBURSEMENT) at zero balance', async () => {
    const res = await request(app).get('/wallets').set(apiKeyHeader(acc.apiKey));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    for (const w of res.body.data) {
      expect(Number(w.balance)).toBe(0);
      expect(w.currency).toBe('TZS');
      expect(w.status).toBe('ACTIVE');
    }
  });

  it('admin deposit credits the wallet and writes a full ledger row', async () => {
    const res = await request(app)
      .post(`/admin/accounts/${acc.id}/wallets/COLLECTION/deposit`)
      .set(admin(adminToken))
      .send({ amount: '15000', reason: 'opening float' });
    expect(res.status).toBe(201);
    const tx = res.body.data;
    expect(Number(tx.amount)).toBe(15000);
    expect(Number(tx.balanceBefore)).toBe(0);
    expect(Number(tx.balanceAfter)).toBe(15000);
    expect(tx.type).toBe('DEPOSIT');
  });

  it('API deposit requires the explicit walletActions permission (default denied)', async () => {
    const denied = await request(app)
      .post('/wallets/COLLECTION/deposit')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '5000', reason: 'nope' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('WALLET_ACTIONS_NOT_GRANTED');

    // grant walletActions on the COLLECTION permission
    const perm = await request(app)
      .put(`/admin/accounts/${acc.id}/permissions`)
      .set(admin(adminToken))
      .send({ permissions: [{ service: 'COLLECTION', granted: true, meta: { walletActions: true } }] });
    expect(perm.status).toBe(200);
    expect(perm.status).toBe(200);

    const allowed = await request(app)
      .post('/wallets/COLLECTION/deposit')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '5000', reason: 'granted' });
    expect(allowed.status).toBe(201);
    expect(Number(allowed.body.data.balanceAfter)).toBe(5000);
  });

  it('withdrawal refuses to overdraw the wallet', async () => {
    await request(app)
      .post(`/admin/accounts/${acc.id}/wallets/DISBURSEMENT/deposit`)
      .set(admin(adminToken))
      .send({ amount: '1000', reason: 'small float' });
    const res = await request(app)
      .post(`/admin/accounts/${acc.id}/wallets/DISBURSEMENT/withdraw`)
      .set(admin(adminToken))
      .send({ amount: '1000.01', reason: 'overdraw attempt' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('withdrawal debits with precise before/after balances', async () => {
    await request(app)
      .post(`/admin/accounts/${acc.id}/wallets/DISBURSEMENT/deposit`)
      .set(admin(adminToken))
      .send({ amount: '5000', reason: 'float' });
    const res = await request(app)
      .post(`/admin/accounts/${acc.id}/wallets/DISBURSEMENT/withdraw`)
      .set(admin(adminToken))
      .send({ amount: '1500.50', reason: 'settlement' });
    expect(res.status).toBe(201);
    expect(Number(res.body.data.balanceBefore)).toBe(5000);
    expect(Number(res.body.data.balanceAfter)).toBeCloseTo(3499.5, 2);
    expect(Number(res.body.data.amount)).toBe(-1500.5);
  });

  it('freeze blocks API withdrawals and unfreeze restores access', async () => {
    await request(app)
      .post(`/admin/accounts/${acc.id}/wallets/DISBURSEMENT/deposit`)
      .set(admin(adminToken))
      .send({ amount: '2000', reason: 'float' });
    await request(app).post(`/admin/accounts/${acc.id}/wallets/DISBURSEMENT/freeze`).set(admin(adminToken));

    const blocked = await request(app)
      .post(`/admin/accounts/${acc.id}/wallets/DISBURSEMENT/withdraw`)
      .set(admin(adminToken))
      .send({ amount: '100', reason: 'frozen attempt' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('WALLET_FROZEN');

    await request(app).post(`/admin/accounts/${acc.id}/wallets/DISBURSEMENT/activate`).set(admin(adminToken));
    const ok = await request(app)
      .post(`/admin/accounts/${acc.id}/wallets/DISBURSEMENT/withdraw`)
      .set(admin(adminToken))
      .send({ amount: '100', reason: 'after unfreeze' });
    expect(ok.status).toBe(201);
  });

  it('wallet transaction history is paginated and ordered newest first', async () => {
    for (const amount of ['100', '200', '300', '400']) {
      await request(app)
        .post(`/admin/accounts/${acc.id}/wallets/COLLECTION/deposit`)
        .set(admin(adminToken))
        .send({ amount, reason: `batch ${amount}` });
    }
    const res = await request(app).get('/wallets/COLLECTION/transactions?limit=2&page=2').set(apiKeyHeader(acc.apiKey));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].createdAt >= res.body.data[1].createdAt).toBe(true);
    expect(res.body.meta.pagination.total).toBe(4);
  });

  it('ledger reconciliation detects consistency after many movements', async () => {
    await request(app).post(`/admin/accounts/${acc.id}/wallets/COLLECTION/deposit`).set(admin(adminToken)).send({ amount: '1000', reason: 'topup-a' });
    await request(app).post(`/admin/accounts/${acc.id}/wallets/COLLECTION/withdraw`).set(admin(adminToken)).send({ amount: '400', reason: 'pull-b' });
    await request(app).post(`/admin/accounts/${acc.id}/wallets/COLLECTION/deposit`).set(admin(adminToken)).send({ amount: '250', reason: 'topup-c' });

    const wallet = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'COLLECTION' } });
    const agg = await prisma(app).walletTransaction.aggregate({ where: { walletId: wallet!.id }, _sum: { amount: true } });
    expect(Number(agg._sum.amount)).toBe(850);
    expect(Number(wallet!.balance)).toBe(850);
  });
});
