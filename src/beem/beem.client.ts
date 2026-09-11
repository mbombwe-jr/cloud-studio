import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosInstance } from 'axios';
import { IiiTracingService } from '../iii/tracing.service';
import {
  ProviderResult,
  SmsProvider,
  SmsSendRequest,
  SmsSendResponse,
} from '../providers/provider.types';

/**
 * Beem Africa SMS client (https://docs.beem.africa).
 *
 *  - Auth: HTTP Basic (BEEM_API_KEY:BEEM_SECRET_KEY)
 *  - Send:      POST /v1/send
 *  - Senders:   GET  /public/v1/sender-names
 *  - DLR:       GET  /public/v1/delivery-reports?dest_addr=&request_id=
 *  - Balance:   GET  /public/v1/vendors/balance
 *
 * All exchanges are traced (request/response snapshots preserved).
 */
@Injectable()
export class BeemClient implements SmsProvider {
  readonly name = 'BEEM';
  private http: AxiosInstance;
  private basicAuth: string;

  constructor(
    private readonly config: ConfigService,
    private readonly tracing: IiiTracingService,
  ) {
    const axios = require('axios');
    this.http = axios.create({
      baseURL: this.config.get('beem.baseUrl'),
      timeout: 30_000,
      validateStatus: () => true,
    });
    const key = this.config.get<string>('beem.apiKey') ?? '';
    const secret = this.config.get<string>('beem.secretKey') ?? '';
    this.basicAuth = Buffer.from(`${key}:${secret}`).toString('base64');
  }

  private get credentialsReady(): boolean {
    return Boolean(this.config.get('beem.apiKey') && this.config.get('beem.secretKey'));
  }

  private async request<T>(operation: string, method: 'get' | 'post', url: string, data?: unknown, params?: Record<string, unknown>): Promise<ProviderResult<T>> {
    if (!this.credentialsReady) return { ok: false, error: 'Beem credentials not configured (BEEM_API_KEY / BEEM_SECRET_KEY)' };
    return this.tracing.traceCall(operation, 'beem', async (span) => {
      span.event('request', { method, url, data, params });
      try {
        const res = await this.http.request({
          method,
          url,
          data,
          params,
          headers: { Authorization: `Basic ${this.basicAuth}`, 'Content-Type': 'application/json' },
        });
        span.event('response', { status: res.status, body: res.data });
        if (res.status >= 200 && res.status < 300) {
          return { ok: true, httpStatus: res.status, data: res.data as T, raw: res.data };
        }
        return { ok: false, httpStatus: res.status, error: (res.data as any)?.message ?? `Beem returned ${res.status}`, raw: res.data };
      } catch (err: any) {
        span.event('transport-error', { message: err?.message });
        return { ok: false, error: err?.message ?? 'Beem request failed' };
      }
    });
  }

  send(req: SmsSendRequest): Promise<ProviderResult<SmsSendResponse>> {
    // Beem wire format (verified against docs.beem.africa 2026-09):
    //   { source_addr, message, encoding, recipients: [{ recipient_id: <int>, dest_addr: "255..." }] }
    // The platform's internal SmsRecipient uses camelCase — map at the boundary.
    const payload = {
      source_addr: req.source_addr,
      message: req.message,
      encoding: req.encoding,
      ...(req.schedule_time ? { schedule_time: req.schedule_time } : {}),
      recipients: (req.recipients ?? []).map((r, i) => ({
        recipient_id: Number(r.recipientId ?? i + 1),
        dest_addr: String(r.destAddr),
      })),
    };
    return this.request('beem.send-sms', 'post', '/v1/send', payload);
  }

  listSenderNames(): Promise<ProviderResult<{ senderName: string; status?: string }[]>> {
    // NOTE: Beem returns 500 when extra query params (e.g. limit=100) are sent
    // on this endpoint — call it bare (verified live 2026-09).
    return this.request('beem.list-sender-names', 'get', '/public/v1/sender-names');
  }

  deliveryReport(requestId: string, destAddr: string): Promise<ProviderResult<Record<string, any>>> {
    return this.request('beem.delivery-report', 'get', '/public/v1/delivery-reports', undefined, { request_id: requestId, dest_addr: destAddr });
  }

  balance(): Promise<ProviderResult<Record<string, any>>> {
    return this.request('beem.balance', 'get', '/public/v1/vendors/balance');
  }
}
