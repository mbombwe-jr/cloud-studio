import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  createAccount, createApp, createStaff, prisma, request, admin, truncateAll,
  apiKeyHeader, mockPayout, mockCollection, waitFor,
} from './helpers';
import { SettlementsService } from '../src/settlements/settlements.service';

/**
 * Settlements, deposits, transfers & fees (requirements #1-#7).
 * All provider behaviour runs on the deterministic in-process mocks.
 */
describe('Settlements / Deposits / Transfers / Fees (e2e)', () => {
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
      services: {
        COLLECTION: { granted: true, meta: { channels: ['MOBILE_MONEY'] } },
        DISBURSEMENT: { granted: true, meta: { channels: ['MOBILE_MONEY', 'BANK'] } },
      },
    });
    mockPayout(app).defaultPayoutStatus = 'SUCCESS';
    mockPayout(app).payoutStatuses.clear();
    mockCollection(app).collectionStatuses.clear();
    mockCollection(app).defaultCollectionStatus = 'SUCCESS';
  });

  afterAll(async () => {
    await app.close();
  });

  it('onboarding captures settlement details (mobile: method+phone; bank: number+bank name+initials)', async () => {
    const mobile = await request(app)
      .post('/admin/accounts')
      .set(admin(adminToken))
      .send({
        accountName: 'Mobile Settled Ltd',
        settlement: { type: 'MOBILE', method: 'AIRTEL', phoneNumber: '0781234567' },
      });
    expect(mobile.status).toBe(201);
    const settlement = await request(app)
      .get(`/admin/accounts/${mobile.body.data.account.id}/settlement`)
      .set(admin(adminToken));
    if (settlement.status !== 200) console.log('SETTLEMENT GET', settlement.status, JSON.stringify(settlement.body).slice(0, 400));
    expect(settlement.status).toBe(200);
    expect(settlement.body.data).toHaveLength(1);
    expect(settlement.body.data[0]).toMatchObject({ type: 'MOBILE', method: 'AIRTEL', phoneNumber: '255781234567', isDefault: true });

    const bank = await request(app)
      .post('/admin/accounts')
      .set(admin(adminToken))
      .send({
        accountName: 'Bank Settled Ltd',
        settlement: { type: 'BANK', bankName: 'CRDB Bank', bankInitials: 'CRDB', accountNumber: '0676544740', accountName: 'DEO MBOMBWE' },
      });
    expect(bank.status).toBe(201);
    const bankSettlement = await request(app)
      .get(`/admin/accounts/${bank.body.data.account.id}/settlement`)
      .set(admin(adminToken));
    expect(bankSettlement.body.data[0]).toMatchObject({ type: 'BANK', bankName: 'CRDB Bank', bankInitials: 'CRDB', accountNumber: '0676544740' });

    // invalid mobile settlement is rejected (no method)
    const bad = await request(app)
      .post('/admin/accounts')
      .set(admin(adminToken))
      .send({ accountName: 'Bad Ltd', settlement: { type: 'MOBILE', phoneNumber: '0781234567' } });
    expect(bad.status).toBe(400);

    // invalid bank settlement is rejected (missing accountNumber)
    const badBank = await request(app)
      .post('/admin/accounts')
      .set(admin(adminToken))
      .send({ accountName: 'Bad Bank Ltd', settlement: { type: 'BANK', bankName: 'NMB' } });
    expect(badBank.status).toBe(400);
  });

  it('autoSweep defaults to true and can be toggled per account', async () => {
    const overview = await request(app).get(`/admin/accounts/${acc.id}/overview`).set(admin(adminToken));
    if (overview.status !== 200) console.log('OVERVIEW', overview.status, JSON.stringify(overview.body).slice(0, 300));
    expect(overview.body.data.account.autoSweep).toBe(true);
    const off = await request(app)
      .put(`/admin/accounts/${acc.id}/settlement/auto-sweep`)
      .set(admin(adminToken))
      .send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.data.autoSweep).toBe(false);
  });

  it('fees default to 5% below 3000 TZS and 2% at/above, per service, and are customizable', async () => {
    const cfg = await request(app).get(`/admin/accounts/${acc.id}/fees`).set(admin(adminToken));
    expect(cfg.status).toBe(200);
    expect(cfg.body.data).toMatchObject({
      collectionBelowBps: 500, collectionThreshold: '3000', collectionAboveBps: 200,
      disbursementBelowBps: 500, disbursementAboveBps: 200, transferBps: 200,
    });

    const updated = await request(app)
      .put(`/admin/accounts/${acc.id}/fees`)
      .set(admin(adminToken))
      .send({ collectionBelowBps: 300, collectionAboveBps: 150, transferBps: 100 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.collectionBelowBps).toBe(300);
    expect(updated.body.data.transferBps).toBe(100);

    // invalid bps rejected
    const invalid = await request(app)
      .put(`/admin/accounts/${acc.id}/fees`)
      .set(admin(adminToken))
      .send({ collectionBelowBps: 99999 });
    expect(invalid.status).toBe(400);
  });

  it('collection below threshold charges 5%, at/above charges 2%', async () => {
    // fund collection wallet to keep the ledger well-formed; the fee applies on credit
    const small = await request(app)
      .post('/collections/ussd-push')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '2000', phoneNumber: '255712345678', reference: 'SMALL1' });
    expect(small.status).toBe(201);
    await request(app).post('/webhooks/clickpesa').send({
      event: 'PAYMENT RECEIVED',
      data: { id: 'TX-SMALL', status: 'SUCCESS', orderReference: small.body.data.reference, collectedAmount: '2000' },
    });
    const smallRow = await prisma(app).collection.findUnique({ where: { reference: small.body.data.reference } });
    expect(Number(smallRow!.feeAmount)).toBe(100); // 5% of 2000
    expect(smallRow!.feeBps).toBe(500);

    const big = await request(app)
      .post('/collections/ussd-push')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '3000', phoneNumber: '255712345678', reference: 'BIG001' });
    await request(app).post('/webhooks/clickpesa').send({
      event: 'PAYMENT RECEIVED',
      data: { id: 'TX-BIG', status: 'SUCCESS', orderReference: big.body.data.reference, collectedAmount: '3000' },
    });
    const bigRow = await prisma(app).collection.findUnique({ where: { reference: big.body.data.reference } });
    expect(Number(bigRow!.feeAmount)).toBe(60); // 2% of 3000 (at threshold)
    expect(bigRow!.feeBps).toBe(200);
  });

  it('deposit: USSD push authorises the amount and credits the DISBURSEMENT wallet', async () => {
    const init = await request(app)
      .post('/wallets/deposits')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '15000', phoneNumber: '255712345678', reference: 'DEP001' });
    expect(init.status).toBe(201);
    expect(init.body.data.status).toBe('PROCESSING');
    expect(init.body.data.reference).toHaveLength(20);

    // payer authorises via provider webhook
    await request(app).post('/webhooks/clickpesa').send({
      event: 'PAYMENT RECEIVED',
      data: { id: 'TX-DEP-1', status: 'SUCCESS', orderReference: init.body.data.reference, collectedAmount: '15000' },
    });

    const deposit = await request(app)
      .get(`/wallets/deposits/${init.body.data.reference}`)
      .set(apiKeyHeader(acc.apiKey));
    expect(deposit.body.data.status).toBe('SUCCESS');
    expect(deposit.body.data.walletCreditedAt).toBeTruthy();

    // DISBURSEMENT wallet credited, COLLECTION wallet untouched
    const disb = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'DISBURSEMENT' } });
    expect(Number(disb!.balance)).toBe(15000);
    const col = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'COLLECTION' } });
    expect(Number(col!.balance)).toBe(0);

    // ledger entry typed DEPOSIT
    const txs = await prisma(app).walletTransaction.findMany({ where: { walletId: disb!.id } });
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe('DEPOSIT');
    expect(txs[0].reference).toBe(init.body.data.reference);

    // duplicate webhook must not double-credit
    await request(app).post('/webhooks/clickpesa').send({
      event: 'PAYMENT RECEIVED',
      data: { id: 'TX-DEP-1', status: 'SUCCESS', orderReference: init.body.data.reference, collectedAmount: '15000' },
    });
    const disbAgain = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'DISBURSEMENT' } });
    expect(Number(disbAgain!.balance)).toBe(15000);
  });

  it('wallet transfer: moves COLLECTION -> DISBURSEMENT instantly with the custom fee (default 2%)', async () => {
    await createAccount(app, adminToken, {}); // ensure helper path stays exercised
    // fund the collection wallet via admin deposit
    const fund = await request(app)
      .post(`/admin/accounts/${acc.id}/wallets/COLLECTION/deposit`)
      .set(admin(adminToken))
      .send({ amount: '50000', reason: 'test funding' });
    expect(fund.status).toBe(201);

    const transfer = await request(app)
      .post('/wallets/transfers')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '10000', reference: 'TRF001' });
    expect(transfer.status).toBe(201);
    expect(transfer.body.data.status).toBe('SUCCESS');
    expect(Number(transfer.body.data.feeAmount)).toBe(200); // 2% default
    expect(transfer.body.data.feeBps).toBe(200);

    const col = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'COLLECTION' } });
    expect(Number(col!.balance)).toBe(39800); // 50000 - 10200
    const disb = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'DISBURSEMENT' } });
    expect(Number(disb!.balance)).toBe(10000);

    // both ledger legs recorded
    const outTx = await prisma(app).walletTransaction.findFirst({ where: { walletId: col!.id, type: 'TRANSFER_OUT' } });
    const inTx = await prisma(app).walletTransaction.findFirst({ where: { walletId: disb!.id, type: 'TRANSFER_IN' } });
    expect(outTx && inTx).toBeTruthy();
    expect(outTx!.reference).toBe(inTx!.reference);

    // overdraft is rejected atomically
    const tooBig = await request(app)
      .post('/wallets/transfers')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '999999' });
    expect(tooBig.status).toBe(403);

    // duplicate reference rejected
    const dupe = await request(app)
      .post('/wallets/transfers')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '100', reference: 'TRF001' });
    expect(dupe.status).toBe(409);
  });

  it('withdrawal: settles a specific amount from COLLECTION to the settlement account', async () => {
    // set up settlement account (bank) + fund collection wallet
    const setCreate = await request(app)
      .post(`/admin/accounts/${acc.id}/settlement`)
      .set(admin(adminToken))
      .send({ type: 'BANK', bankName: 'CRDB Bank', bankInitials: 'CRDB', accountNumber: '0676544740', accountName: 'DEO MBOMBWE' });
    if (setCreate.status !== 201) console.log('SETCREATE', setCreate.status, JSON.stringify(setCreate.body).slice(0, 300));
    expect(setCreate.status).toBe(201);
    await request(app)
      .post(`/admin/accounts/${acc.id}/wallets/COLLECTION/deposit`)
      .set(admin(adminToken))
      .send({ amount: '50000', reason: 'test funding' });

    const withdraw = await request(app)
      .post('/wallets/withdrawals')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '20000', reference: 'WD001' });
    if (withdraw.status !== 201) console.log('WITHDRAW', withdraw.status, JSON.stringify(withdraw.body).slice(0, 300));
    expect(withdraw.status).toBe(201);
    expect(withdraw.body.data.payoutKind).toBe('WITHDRAWAL');
    expect(withdraw.body.data.sourceWallet).toBe('COLLECTION');
    expect(withdraw.body.data.channel).toBe('BANK');
    expect(withdraw.body.data.accountNumber).toBe('0676544740');
    expect(Number(withdraw.body.data.feeAmount)).toBe(400); // 2% of 20000

    // collection wallet debited amount + fee
    const col = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'COLLECTION' } });
    expect(Number(col!.balance)).toBe(29600); // 50000 - 20400

    // provider processes it via queue
    expect(await waitFor(async () => {
      const fresh = await prisma(app).payout.findUnique({ where: { reference: withdraw.body.data.reference } });
      return fresh?.status === 'SUCCESS';
    })).toBe(true);

    // failed provider payout refunds the full debit to the COLLECTION wallet
    await request(app)
      .post(`/admin/accounts/${acc.id}/settlement`)
      .set(admin(adminToken))
      .send({ type: 'MOBILE', method: 'TIGO', phoneNumber: '0700000000' }); // doomed: ends 0000
    const fail = await request(app)
      .post('/wallets/withdrawals')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '1000' }); // settles to the doomed TIGO settlement account
    expect(fail.status).toBe(201);
    expect(await waitFor(async () => {
      const fresh = await prisma(app).payout.findUnique({ where: { reference: fail.body.data.reference } });
      return fresh?.status === 'FAILED';
    })).toBe(true);
    const colAfter = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'COLLECTION' } });
    // 29600 - (1000 + 20) + (1000 + 20 refund) = 29600
    expect(Number(colAfter!.balance)).toBe(29600);
  });

  it('mobile money payout preview returns operator, fee and active methods without executing', async () => {
    const preview = await request(app)
      .post('/disbursements/mobile-money/preview')
      .set(apiKeyHeader(acc.apiKey))
      .send({ amount: '25000', phoneNumber: '0751234567' });
    expect(preview.status).toBe(201);
    expect(preview.body.data).toMatchObject({
      channel: 'MOBILE_MONEY',
      phoneNumber: '255751234567',
      operator: 'VODACOM',
      amount: '25000.00',
      executed: false,
    });
    expect(preview.body.data.fee).toMatchObject({ amount: '500.00', bps: 200, tier: 'ABOVE' });
    expect(preview.body.data.totalDebit).toBe('25500.00');
    expect(preview.body.data.activeMethods.length).toBeGreaterThan(0);

    // nothing was executed
    const payouts = await prisma(app).payout.findMany({ where: { accountId: acc.id } });
    expect(payouts).toHaveLength(0);
    const disb = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'DISBURSEMENT' } });
    expect(Number(disb!.balance)).toBe(0);
  });

  it('sweep-now settles the full collection balance into the settlement account (fee deducted from sweep)', async () => {
    const setCreate2 = await request(app)
      .post(`/admin/accounts/${acc.id}/settlement`)
      .set(admin(adminToken))
      .send({ type: 'MOBILE', method: 'AIRTEL', phoneNumber: '0781234567' });
    if (setCreate2.status !== 201) console.log('SETCREATE2', setCreate2.status, JSON.stringify(setCreate2.body).slice(0, 300));
    expect(setCreate2.status).toBe(201);
    await request(app)
      .post(`/admin/accounts/${acc.id}/wallets/COLLECTION/deposit`)
      .set(admin(adminToken))
      .send({ amount: '50000', reason: 'test funding' });

    const sweep = await request(app)
      .post(`/admin/accounts/${acc.id}/settlement/sweep-now`)
      .set(admin(adminToken));
    if (sweep.status !== 201) console.log('SWEEP', sweep.status, JSON.stringify(sweep.body).slice(0, 300));
    expect(sweep.status).toBe(201);
    expect(sweep.body.data.swept).toBe('50000.00');
    expect(sweep.body.data.feeAmount).toBe('1000.00'); // 2% of 50000
    expect(sweep.body.data.payoutAmount).toBe('49000.00');
    expect(sweep.body.data.payout.payoutKind).toBe('AUTO_SWEEP');
    expect(sweep.body.data.payout.channel).toBe('MOBILE_MONEY');
    expect(sweep.body.data.payout.phoneNumber).toBe('255781234567');

    // collection wallet emptied by the sweep
    const col = await prisma(app).wallet.findFirst({ where: { accountId: acc.id, type: 'COLLECTION' } });
    expect(Number(col!.balance)).toBe(0);

    // provider finalizes
    expect(await waitFor(async () => {
      const fresh = await prisma(app).payout.findUnique({ where: { reference: sweep.body.data.payout.reference } });
      return fresh?.status === 'SUCCESS';
    })).toBe(true);
  });

  it('runAutoSweep skips accounts without settlement accounts and empty wallets', async () => {
    const settlements = app.get(SettlementsService);
    // no settlement account configured for acc
    const result = await settlements.runAutoSweep();
    expect(result.created).toBe(0);
    expect(result.details.some((d) => d.reason === 'no settlement account')).toBe(true);
  });
});
