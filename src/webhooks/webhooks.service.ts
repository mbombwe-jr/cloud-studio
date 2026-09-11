import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WebhookEvent } from '@prisma/client';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { IiiQueueService } from '../iii/queue.service';
import { IiiLoggerService } from '../iii/logger.service';
import { IiiTracingService } from '../iii/tracing.service';
import { ErrorCodes } from '../common/constants';

/**
 * Outgoing webhook engine — the "callback for transaction feedback" required
 * by the spec:
 *  - accounts register callback endpoints with the events they want;
 *  - every event is delivered as a signed HTTP POST (HMAC-SHA256 over the raw
 *    body, header: X-Zoo-Signature) with durable retry + backoff;
 *  - deliveries are recorded row-by-row so nothing is lost.
 */
@Injectable()
export class WebhookEndpointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: IiiQueueService,
    private readonly logger: IiiLoggerService,
    private readonly tracing: IiiTracingService,
  ) {}

  async list(accountId: string) {
    return this.prisma.webhookEndpoint.findMany({
      where: { accountId },
      select: { id: true, url: true, events: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(accountId: string, dto: { url: string; events: WebhookEvent[] }) {
    const existing = await this.prisma.webhookEndpoint.findMany({ where: { accountId } });
    if (existing.length >= 5) {
      throw new ForbiddenException({ code: ErrorCodes.CONFLICT, message: 'At most 5 webhook endpoints per account' });
    }
    // the secret is shown once so the account can verify signatures
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: { accountId, url: dto.url, events: dto.events, secret },
    });
    return { id: endpoint.id, url: endpoint.url, events: endpoint.events, isActive: endpoint.isActive, secret, createdAt: endpoint.createdAt };
  }

  async update(accountId: string, endpointId: string, dto: { url?: string; events?: WebhookEvent[] }) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({ where: { id: endpointId, accountId } });
    if (!endpoint) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Webhook endpoint not found' });
    return this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: {
        ...(dto.url ? { url: dto.url } : {}),
        ...(dto.events ? { events: dto.events } : {}),
      },
      select: { id: true, url: true, events: true, isActive: true, createdAt: true },
    });
  }

  async remove(accountId: string, endpointId: string) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({ where: { id: endpointId, accountId } });
    if (!endpoint) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Webhook endpoint not found' });
    await this.prisma.webhookEndpoint.delete({ where: { id: endpointId } });
    return { id: endpointId, deleted: true };
  }

  /**
   * Fans an event out to every active subscribed endpoint of the account.
   * Creates a WebhookDelivery row per endpoint and enqueues the HTTP call.
   */
  async dispatch(event: WebhookEvent, accountId: string, reference: string, payload: Record<string, unknown>, traceId?: string): Promise<number> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { accountId, isActive: true, events: { has: event } },
    });
    for (const endpoint of endpoints) {
      const body = {
        event,
        accountId,
        reference,
        data: payload,
        timestamp: new Date().toISOString(),
      };
      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          event,
          reference,
          payload: body as Prisma.InputJsonValue,
          status: 'PENDING',
        },
      });
      await this.queue.enqueue('webhook.deliver', { deliveryId: delivery.id, traceId });
    }
    if (endpoints.length > 0) {
      this.logger.info('webhook event dispatched', { module: 'webhooks', event, reference, endpoints: endpoints.length, traceId });
    }
    return endpoints.length;
  }

  /** Queue handler: performs the signed HTTP POST with durable retries. */
  async deliverJob(payload: { deliveryId: string }): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({ where: { id: payload.deliveryId }, include: { endpoint: true } });
    if (!delivery || delivery.status === 'DELIVERED') return;
    if (!delivery.endpoint.isActive) {
      await this.prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { status: 'FAILED', lastError: 'endpoint disabled' } });
      return;
    }

    const body = JSON.stringify(delivery.payload);
    const signature = createHmac('sha256', delivery.endpoint.secret).update(body).digest('hex');
    const attempts = delivery.attempts + 1;

    return this.tracing.traceCall('webhook.deliver', 'webhooks', async (span) => {
      span.event('request', { url: delivery.endpoint.url, attempt: attempts, event: delivery.event, reference: delivery.reference });
      const axios = require('axios');
      let status: number | undefined;
      let errorText: string | undefined;
      try {
        const res = await axios.post(delivery.endpoint.url, body, {
          timeout: 10_000,
          validateStatus: () => true,
          headers: {
            'Content-Type': 'application/json',
            'X-Zoo-Event': delivery.event,
            'X-Zoo-Reference': delivery.reference,
            'X-Zoo-Delivery-Id': delivery.id,
            'X-Zoo-Signature': `sha256=${signature}`,
          },
        });
        status = res.status;
        span.event('response', { status: res.status });
      } catch (err: any) {
        errorText = err?.message ?? 'delivery failed';
        span.event('transport-error', { message: errorText });
      }

      const ok = status !== undefined && status >= 200 && status < 300;
      if (ok) {
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'DELIVERED', attempts, lastAttemptAt: new Date(), responseStatus: status },
        });
        return;
      }

      const exhausted = attempts >= 5;
      const base = parseInt(process.env.WEBHOOK_BACKOFF_BASE_MS || '60000', 10);
      const backoffMs = base * Math.pow(2, Math.min(attempts - 1, 5));
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: exhausted ? 'DEAD' : 'PENDING',
          attempts,
          lastAttemptAt: new Date(),
          nextAttemptAt: exhausted ? undefined : new Date(Date.now() + backoffMs),
          responseStatus: status,
          lastError: errorText ?? `HTTP ${status}`,
        },
      });
      if (!exhausted) {
        // schedule the retry through the queue's delayed execution
        await this.queue.enqueue('webhook.deliver', { deliveryId: delivery.id }, { delayMs: backoffMs });
      }
      this.logger.warn('webhook delivery failed', { module: 'webhooks', deliveryId: delivery.id, status, error: errorText });
    });
  }

  /** Re-delivers due retries (cron safety net if a delayed job was lost). */
  async sweepDueRetries(): Promise<void> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() }, attempts: { gt: 0 } },
      take: 50,
      select: { id: true },
    });
    for (const d of due) {
      await this.queue.enqueue('webhook.deliver', { deliveryId: d.id });
    }
  }
}
