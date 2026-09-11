/** Provider abstraction — lets Zoostudios swap rails without touching business logic. */

export interface ProviderResult<T> {
  ok: boolean;
  httpStatus?: number;
  data?: T;
  error?: string;
  raw?: unknown;
}

// ---------------------------- Collection -----------------------------

export interface UssdPreviewRequest {
  amount: string;
  currency: string;
  orderReference: string;
  phoneNumber: string;
  fetchSenderDetails?: boolean;
  checksum?: string;
}

export interface UssdActiveMethod {
  name: string;
  status: string;
  fee?: number;
  message?: any;
}

export interface UssdPreviewResponse {
  activeMethods: UssdActiveMethod[];
  sender?: {
    accountName: string;
    accountNumber: string;
    accountProvider: string;
  };
}

export interface UssdInitiateResponse {
  id: string;
  status: string;
  channel: string;
  orderReference: string;
  collectedAmount: string;
  collectedCurrency: string;
  createdAt: string;
  clientId: string;
}

export interface PaymentRecord {
  id: string;
  status: string;
  exchanged?: boolean;
  exchange?: { sourceCurrency: string; targetCurrency: string; sourceAmount: number; rate: number };
  paymentReference?: string;
  paymentPhoneNumber?: string;
  orderReference: string;
  collectedAmount?: number | string;
  collectedCurrency?: string;
  message?: string;
  updatedAt?: string;
  createdAt?: string;
  customer?: {
    customerName?: string;
    customerPhoneNumber?: string;
    customerEmail?: string;
  } | null;
  clientId?: string;
}

export interface CollectionProvider {
  readonly name: string;
  previewUssdPush(req: UssdPreviewRequest): Promise<ProviderResult<UssdPreviewResponse>>;
  initiateUssdPush(req: UssdPreviewRequest): Promise<ProviderResult<UssdInitiateResponse>>;
  queryPayment(orderReference: string): Promise<ProviderResult<PaymentRecord[]>>;
}

// ---------------------------- Disbursement ---------------------------

export interface MnoPayoutRequest {
  amount: number;
  currency: 'TZS' | 'USD';
  orderReference: string;
  phoneNumber: string;
  checksum?: string;
}

export interface BankPayoutRequest {
  amount: number;
  accountNumber: string;
  accountName: string;
  orderReference: string;
  bic: string;
  accountCurrency: string;
  currency: string;
  transferType?: 'ACH' | 'RTGS';
  checksum?: string;
}

export interface PayoutRecord {
  id?: string;
  status: string;
  orderReference: string;
  amount?: number | string;
  currency?: string;
  fee?: number | string;
  message?: string;
  channel?: string;
  updatedAt?: string;
  createdAt?: string;
  beneficiary?: Record<string, unknown>;
  refund?: { message?: string; refundedAt?: string };
  reverse?: { message?: string; reversedAt?: string };
}

export interface MnoPayoutPreviewResponse {
  activeMethods?: UssdActiveMethod[];
  sender?: {
    accountName: string;
    accountNumber: string;
    accountProvider: string;
  };
}

export interface PayoutProvider {
  readonly name: string;
  createMobileMoneyPayout(req: MnoPayoutRequest): Promise<ProviderResult<PayoutRecord>>;
  createBankPayout(req: BankPayoutRequest): Promise<ProviderResult<PayoutRecord>>;
  queryPayout(orderReference: string): Promise<ProviderResult<PayoutRecord[]>>;
  /** Optional provider-side payout preview; implementations may omit it. */
  previewMnoPayout?(req: MnoPayoutRequest): Promise<ProviderResult<MnoPayoutPreviewResponse | null>>;
}

// -------------------------------- SMS --------------------------------

export interface SmsRecipient {
  recipientId: number;
  destAddr: string;
}

export interface SmsSendRequest {
  source_addr: string;
  message: string;
  encoding: number;
  recipients: SmsRecipient[];
  schedule_time?: string;
}

export interface SmsSendResponse {
  successful: boolean;
  request_id: string;
  code: number;
  message: string;
  valid?: number;
  invalid?: number;
}

export interface SmsProvider {
  readonly name: string;
  send(req: SmsSendRequest): Promise<ProviderResult<SmsSendResponse>>;
  listSenderNames(): Promise<ProviderResult<{ senderName: string; status?: string }[]>>;
  deliveryReport(requestId: string, destAddr: string): Promise<ProviderResult<Record<string, any>>>;
  balance(): Promise<ProviderResult<Record<string, any>>>;
}

export const COLLECTION_PROVIDER = Symbol('COLLECTION_PROVIDER');
export const PAYOUT_PROVIDER = Symbol('PAYOUT_PROVIDER');
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
