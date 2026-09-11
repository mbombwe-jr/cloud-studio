import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { createPayloadChecksum } from '../common/utils/checksum.util';
import { IiiLoggerService } from '../iii/logger.service';
import { IiiTracingService } from '../iii/tracing.service';
import {
  BankPayoutRequest,
  CollectionProvider,
  MnoPayoutRequest,
  PaymentRecord,
  PayoutProvider,
  PayoutRecord,
  ProviderResult,
  SmsProvider,
  SmsSendRequest,
  SmsSendResponse,
  UssdInitiateResponse,
  UssdPreviewRequest,
  UssdPreviewResponse,
} from '../providers/provider.types';

const TOKEN_TTL_MS = 55 * 60 * 1000; // refresh before expiry

/**
 * ClickPesa client (https://docs.clickpesa.com).
 *
 *  - Authorization: POST /third-parties/generate-token with `api-key` and
 *    `client-id` headers; tokens are cached and refreshed on 401.
 *  - Collection: preview / initiate USSD push + payment queries.
 *  - Payouts: mobile money + bank payouts (bank payload includes BOTH
 *    `currency` and `accountCurrency`, per Zoostudios integration notes).
 *  - Checksum: HMAC-SHA256 over canonical JSON per docs.home/checksum,
 *    excluded `checksum`/`checksumMethod` from the payload before signing.
 *
 * Every HTTP exchange is recorded as a trace span — request and response
 * snapshots are preserved (nothing is lost for tracing/support).
 */
@Injectable()
export class ClickPesaClient implements CollectionProvider, PayoutProvider {
  readonly name = 'CLICKPESA';
  private token: { value: string; expiresAt: number } | null = null;
  private http: AxiosInstance;

  constructor(
    private readonly config: ConfigService,
    private readonly tracing: IiiTracingService,
    private readonly logger: IiiLoggerService,
  ) {
    // local require keeps axios lazy so the module can load in any context
    const axios = require('axios');
    this.http = axios.create({
      baseURL: this.config.get('clickpesa.baseUrl'),
      timeout: 30_000,
      validateStatus: () => true, // handled manually for precise errors
    });
  }

  private get credentialsReady(): boolean {
    return Boolean(this.config.get('clickpesa.clientId') && this.config.get('clickpesa.apiKey'));
  }

  private async authorize(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    if (!this.credentialsReady) throw new Error('ClickPesa credentials not configured (CLICKPESA_CLIENT_ID / CLICKPESA_API_KEY)');

    const res = await this.http.post(
      '/third-parties/generate-token',
      {},
      { headers: { 'api-key': this.config.get('clickpesa.apiKey'), 'client-id': this.config.get('clickpesa.clientId') } },
    );
    if (res.status !== 200 || !res.data?.token) {
      throw new Error(`ClickPesa token generation failed (${res.status}): ${JSON.stringify(res.data)?.slice(0, 300)}`);
    }
    this.token = { value: res.data.token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return this.token.value;
  }

  private async request<T>(spanOperation: string, method: 'get' | 'post', url: string, body?: unknown, retried = false): Promise<ProviderResult<T>> {
    if (!this.credentialsReady) {
      return { ok: false, error: 'ClickPesa credentials not configured' };
    }
    return this.tracing.traceCall(spanOperation, 'clickpesa', async (span) => {
      span.event('request', { method, url, body: redact(body) });
      try {
        const token = await this.authorize();
        // IMPORTANT (verified live against api.clickpesa.com, 2026-09): the API
        // expects the RAW token in the Authorization header and REJECTS the
        // documented "Bearer <token>" prefix with 401 Unauthorized on every
        // resource endpoint (token generation itself accepts either). The docs
        // example is wrong — send the raw token.
        const headers: Record<string, string> = { Authorization: token };
        if (method === 'post') headers['Content-Type'] = 'application/json';

        const res = await this.http.request({ method, url, data: body, headers });

        // expired/invalidated token: refresh once then retry
        if (res.status === 401 && !retried) {
          this.token = null;
          return this.request<T>(spanOperation, method, url, body, true);
        }

        span.event('response', { status: res.status, body: redact(res.data) });

        if (res.status >= 200 && res.status < 300) {
          return { ok: true, httpStatus: res.status, data: res.data as T, raw: res.data };
        }
        return {
          ok: false,
          httpStatus: res.status,
          error: providerError(res.status, res.data),
          raw: res.data,
        };
      } catch (err: any) {
        span.event('transport-error', { message: err?.message });
        return { ok: false, error: err?.message ?? 'ClickPesa request failed' };
      }
    });
  }

  private sign<T extends Record<string, unknown>>(payload: T): T {
    if (!this.config.get('clickpesa.checksumEnabled')) return payload;
    const key = this.config.get('clickpesa.checksumKey');
    if (!key) return payload;
    return { ...payload, checksum: createPayloadChecksum(key, payload) } as T;
  }

  // ------------------------------ Collection -------------------------

  previewUssdPush(req: UssdPreviewRequest): Promise<ProviderResult<UssdPreviewResponse>> {
    return this.request('clickpesa.preview-ussd-push', 'post', '/third-parties/payments/preview-ussd-push-request', this.sign({ ...req }));
  }

  initiateUssdPush(req: UssdPreviewRequest): Promise<ProviderResult<UssdInitiateResponse>> {
    return this.request('clickpesa.initiate-ussd-push', 'post', '/third-parties/payments/initiate-ussd-push-request', this.sign({ ...req }));
  }

  queryPayment(orderReference: string): Promise<ProviderResult<PaymentRecord[]>> {
    return this.request('clickpesa.query-payment', 'get', `/third-parties/payments/${encodeURIComponent(orderReference)}`);
  }

  queryAllPayments(limit = 20): Promise<ProviderResult<{ data: PaymentRecord[]; totalCount: number }>> {
    return this.request('clickpesa.query-all-payments', 'get', `/third-parties/payments/all?orderBy=DESC&limit=${limit}`);
  }

  // ------------------------------ Payouts ----------------------------

  createMobileMoneyPayout(req: MnoPayoutRequest): Promise<ProviderResult<PayoutRecord>> {
    const payload = this.sign({
      amount: req.amount,
      currency: req.currency,
      orderReference: req.orderReference,
      phoneNumber: req.phoneNumber,
    });
    return this.request('clickpesa.create-mno-payout', 'post', '/third-parties/payouts/create-mobile-money-payout', payload);
  }

  createBankPayout(req: BankPayoutRequest): Promise<ProviderResult<PayoutRecord>> {
    // NOTE (Zoostudios integration decision): send BOTH `currency` and
    // `accountCurrency` — the documented payload alone is not sufficient.
    const payload = this.sign({
      amount: req.amount,
      accountNumber: req.accountNumber,
      accountName: req.accountName,
      orderReference: req.orderReference,
      bic: req.bic,
      accountCurrency: req.accountCurrency,
      currency: req.currency,
      ...(req.transferType ? { transferType: req.transferType } : {}),
    });
    return this.request('clickpesa.create-bank-payout', 'post', '/third-parties/payouts/create-bank-payout', payload);
  }

  queryPayout(orderReference: string): Promise<ProviderResult<PayoutRecord[]>> {
    return this.request('clickpesa.query-payout', 'get', `/third-parties/payouts/${encodeURIComponent(orderReference)}`);
  }

  /**
   * Provider-side mobile money payout preview. The endpoint is not part of
   * the public ClickPesa documentation; failures are expected and handled
   * by the caller (graceful degradation to the locally computed preview).
   */
  previewMnoPayout(req: MnoPayoutRequest): Promise<ProviderResult<UssdPreviewResponse | null>> {
    return this.request('clickpesa.preview-mno-payout', 'post', '/third-parties/payouts/preview-mobile-money-payout', this.sign({ ...req }));
  }

  // ------------------------------- SMS -------------------------------

  async listBanks(): Promise<ProviderResult<any>> {
    return this.request('clickpesa.list-banks', 'get', '/third-parties/banks');
  }
}

/** Removes secrets from payloads before they are written to trace spans. */
function redact(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const k of ['checksum', 'api-key', 'apiKey', 'Authorization']) {
    if (k in clone) clone[k] = '***redacted***';
  }
  return clone;
}

/**
 * Builds a precise, actionable error string from a provider error response.
 * ClickPesa returns plain-text bodies for auth errors (e.g. "Unauthorized")
 * and JSON bodies for validation errors — surface BOTH verbatim.
 */
function providerError(status: number, data: unknown): string {
  let detail = '';
  if (typeof data === 'string' && data.trim()) detail = data.trim().slice(0, 200);
  else if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    detail = String(d.message ?? d.error ?? JSON.stringify(data).slice(0, 200));
  }
  const base = `ClickPesa ${status}${detail ? `: ${detail}` : ''}`;
  if (status === 401) {
    return `${base} — check the ClickPesa dashboard: API key scopes (Collections/Disbursements) must be enabled, Whitelisted IP must include this server's egress IP, and after changing checksum settings tokens must be regenerated`;
  }
  return base;
}

/**
 * Verifies an incoming ClickPesa webhook by recomputing the checksum over the
 * payload (minus `checksum`/`checksumMethod`) with the merchant checksum key.
 * When the platform has no checksum key configured, verification is skipped
 * and the receiver relies on authoritative re-querying of the provider.
 */
export function verifyClickPesaWebhook(config: ConfigService, payload: Record<string, unknown>): boolean {
  const key = config.get<string | undefined>('clickpesa.checksumKey');
  if (!key) return true; // no key -> cannot verify; receiver re-queries instead
  const provided = (payload as any).checksum;
  if (!provided) return true; // unsigned webhook -> re-query path
  const { createPayloadChecksum: cpc } = require('../common/utils/checksum.util');
  const expected = cpc(key, payload);
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
