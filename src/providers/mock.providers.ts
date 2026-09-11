import { Injectable } from '@nestjs/common';
import { CollectionProvider, PaymentRecord, PayoutProvider, PayoutRecord, SmsProvider, ProviderResult } from './provider.types';

/**
 * Deterministic in-process mocks used when MOCK_PROVIDERS=true (local dev &
 * automated tests). Behaviours mirror the documented ClickPesa / Beem
 * response shapes so integration code paths are identical.
 *
 * Test hooks:
 *  - collectionStatuses / payoutStatuses: per-reference status overrides
 *  - defaultCollectionStatus / defaultPayoutStatus
 *  - smsFailNext: fail the next send
 */
@Injectable()
export class MockCollectionProvider implements CollectionProvider {
  readonly name = 'MOCK-CLICKPESA';
  defaultCollectionStatus = 'SUCCESS';
  collectionStatuses = new Map<string, string>();
  /** amount recorded at initiation, returned as collectedAmount on query */
  amounts = new Map<string, string>();

  async previewUssdPush(req: { amount: string; phoneNumber: string; fetchSenderDetails?: boolean }): Promise<ProviderResult<any>> {
    return {
      ok: true,
      data: {
        activeMethods: [
          { name: 'M-PESA', status: 'AVAILABLE', fee: 0, message: '' },
          { name: 'MIXX BY YAS', status: 'AVAILABLE', fee: 0, message: '' },
          { name: 'AIRTEL MONEY', status: 'AVAILABLE', fee: 0, message: '' },
          { name: 'HALOPESA', status: 'AVAILABLE', fee: 0, message: '' },
        ],
        ...(req.fetchSenderDetails
          ? { sender: { accountName: 'MOCK SENDER', accountNumber: req.phoneNumber, accountProvider: 'M-PESA' } }
          : {}),
      },
    };
  }

  async initiateUssdPush(req: { amount: string; currency: string; orderReference: string; phoneNumber: string }): Promise<ProviderResult<any>> {
    this.amounts.set(req.orderReference, req.amount);
    return {
      ok: true,
      data: {
        id: `MOCKPAY${Date.now().toString().slice(-8)}`,
        status: 'PROCESSING',
        channel: 'MOBILE MONEY',
        orderReference: req.orderReference,
        collectedAmount: '0',
        collectedCurrency: req.currency,
        createdAt: new Date().toISOString(),
        clientId: 'MOCK-CLIENT-ID',
      },
    };
  }

  async queryPayment(orderReference: string): Promise<ProviderResult<PaymentRecord[]>> {
    const status = this.collectionStatuses.get(orderReference) ?? this.defaultCollectionStatus;
    const amount = this.amounts.get(orderReference);
    return {
      ok: true,
      data: [
        {
          id: `MOCKPAY${orderReference.slice(-8)}`,
          status,
          paymentReference: `pr-${orderReference.toLowerCase()}`,
          paymentPhoneNumber: '255712345678',
          orderReference,
          collectedAmount: status === 'SUCCESS' ? (amount ?? '0') : '0',
          collectedCurrency: 'TZS',
          message: status === 'SUCCESS' ? 'success' : status === 'FAILED' ? 'Insufficient balance' : 'pending',
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          customer: {
            customerName: 'Mock Customer',
            customerPhoneNumber: '255712345678',
            customerEmail: 'mock@example.com',
          },
          clientId: 'MOCK-CLIENT-ID',
        },
      ],
    };
  }
}

@Injectable()
export class MockPayoutProvider implements PayoutProvider {
  readonly name = 'MOCK-CLICKPESA';
  defaultPayoutStatus = 'SUCCESS';
  payoutStatuses = new Map<string, string>();

  /** Deterministic failure rule: numbers/accounts ending in 0000 always fail. */
  private static doomed(dest?: string | null): boolean {
    return Boolean(dest && dest.replace(/\D/g, '').endsWith('0000'));
  }

  private outcome(orderReference: string, dest?: string | null, fallback?: string): string {
    if (this.payoutStatuses.has(orderReference)) return this.payoutStatuses.get(orderReference)!;
    if (MockPayoutProvider.doomed(dest)) return 'FAILED';
    return fallback ?? this.defaultPayoutStatus;
  }

  async createMobileMoneyPayout(req: { amount: number; orderReference: string; phoneNumber: string; currency: string }): Promise<ProviderResult<PayoutRecord>> {
    const status = this.outcome(req.orderReference, req.phoneNumber);
    return {
      ok: true,
      data: {
        id: `MOCKPO${Date.now().toString().slice(-8)}`,
        status,
        orderReference: req.orderReference,
        amount: req.amount,
        currency: req.currency,
        fee: 0,
        message: status === 'SUCCESS' ? 'Payout accepted' : 'Payout rejected by mock',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  }

  async createBankPayout(req: { amount: number; orderReference: string; accountNumber: string; accountName: string; bic: string; currency: string }): Promise<ProviderResult<PayoutRecord>> {
    const status = this.outcome(req.orderReference, req.accountNumber);
    return {
      ok: true,
      data: {
        id: `MOCKPO${Date.now().toString().slice(-8)}`,
        status,
        orderReference: req.orderReference,
        amount: req.amount,
        currency: req.currency,
        fee: 0,
        message: status === 'SUCCESS' ? 'Bank payout accepted' : 'Bank payout rejected by mock',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        beneficiary: { accountNumber: req.accountNumber, accountName: req.accountName },
      },
    };
  }

  /** Mock payout preview — mirrors the USSD push preview shape. */
  async previewMnoPayout(req: { phoneNumber: string }): Promise<ProviderResult<any>> {
    return {
      ok: true,
      data: {
        activeMethods: [
          { name: 'M-PESA', status: 'AVAILABLE', fee: 0, message: '' },
          { name: 'MIXX BY YAS', status: 'AVAILABLE', fee: 0, message: '' },
          { name: 'AIRTEL MONEY', status: 'AVAILABLE', fee: 0, message: '' },
          { name: 'HALOPESA', status: 'AVAILABLE', fee: 0, message: '' },
        ],
        sender: { accountName: 'MOCK BENEFICIARY', accountNumber: req.phoneNumber, accountProvider: 'M-PESA' },
      },
    };
  }

  async queryPayout(orderReference: string): Promise<ProviderResult<PayoutRecord[]>> {
    const status = this.outcome(orderReference);
    return {
      ok: true,
      data: [
        {
          id: `MOCKPO${orderReference.slice(-8)}`,
          status,
          orderReference,
          amount: 1000,
          currency: 'TZS',
          message: status,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }
}

@Injectable()
export class MockSmsProvider implements SmsProvider {
  readonly name = 'MOCK-BEEM';
  smsFailNext = false;
  sendCounter = 0;

  async send(req: { source_addr: string; message: string; recipients: { recipientId: number; destAddr: string }[] }): Promise<ProviderResult<any>> {
    if (this.smsFailNext) {
      this.smsFailNext = false;
      return { ok: false, error: 'Mock SMS gateway unavailable' };
    }
    const invalid = req.recipients.filter((r) => !/^255\d{9}$/.test(r.destAddr)).length;
    this.sendCounter += 1;
    return {
      ok: true,
      data: {
        successful: invalid < req.recipients.length,
        request_id: `mockreq${this.sendCounter}`,
        code: 100,
        message: 'Message submitted successfully',
        valid: req.recipients.length - invalid,
        invalid,
      },
    };
  }

  async listSenderNames(): Promise<ProviderResult<{ senderName: string; status?: string }[]>> {
    return { ok: true, data: [{ senderName: 'MOCKINFO', status: 'ACTIVE' }] };
  }

  async deliveryReport(requestId: string, destAddr: string): Promise<ProviderResult<Record<string, any>>> {
    return {
      ok: true,
      data: {
        request_id: requestId,
        dest_addr: destAddr,
        status: 'DELIVERED',
        code: 300,
        message: 'Delivered to handset',
      },
    };
  }

  async balance(): Promise<ProviderResult<Record<string, any>>> {
    return { ok: true, data: { balance: 1000, currency: 'TZS' } };
  }
}
