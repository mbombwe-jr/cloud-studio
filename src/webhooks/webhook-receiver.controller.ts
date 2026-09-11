import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { verifyClickPesaWebhook } from '../clickpesa/clickpesa.client';
import { TxnStatusService } from './txn-status.service';
import { Public } from '../common/decorators/auth.decorators';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { IiiLoggerService } from '../iii/logger.service';
import { IiiTracingService } from '../iii/tracing.service';

/**
 * Inbound provider webhooks.
 *
 * Security posture (secure-first):
 *  - payload checksum is verified when a ClickPesa checksum key is configured;
 *  - raw payloads are always persisted to trace spans (nothing is lost);
 *  - status is treated as advisory: the platform re-queries the provider for
 *    the authoritative state before finalizing wallet movements;
 *  - unknown references still answer 200 to avoid existence probing.
 */
@ApiTags('webhooks')
@SkipThrottle()
@Controller('webhooks')
export class WebhookReceiverController {
  constructor(
    private readonly txnStatus: TxnStatusService,
    private readonly config: ConfigService,
    private readonly tracing: IiiTracingService,
    private readonly logger: IiiLoggerService,
  ) {}

  @Public()
  @Post('clickpesa')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async clickpesa(@Body() body: Record<string, any>, @Req() req: Request) {
    return this.tracing.traceCall('webhook.clickpesa', 'webhooks', async (span) => {
      span.event('raw-payload', body);
      const valid = verifyClickPesaWebhook(this.config, body ?? {});
      span.event('checksum-verified', { valid });
      if (!valid) {
        this.logger.warn('clickpesa webhook failed checksum verification', { module: 'webhooks', ip: req.ip });
        return { received: true };
      }

      const event = String(body?.event ?? '').toUpperCase();
      const data = body?.data ?? {};
      const orderReference = String(data.orderReference ?? '');
      if (!orderReference) return { received: true };

      try {
        if (event.startsWith('PAYMENT')) {
          // Collections AND wallet deposits share the payment rail; the
          // status engines are individually idempotent and unknown-reference
          // aware, so try collections first, then deposits.
          const applied = await this.txnStatus.applyCollectionUpdate(orderReference, data, 'webhook');
          if (!applied.handled) {
            await this.txnStatus.applyDepositUpdate(orderReference, data, 'webhook');
          }
        } else if (event.startsWith('PAYOUT')) {
          await this.txnStatus.applyPayoutUpdate(orderReference, data, 'webhook');
        } else {
          span.event('unhandled-event', { event });
        }
      } catch (err: any) {
        // never 500 the provider; the cron poller will reconcile
        this.logger.error('webhook processing error (reconciliation will recover)', {
          module: 'webhooks', orderReference, error: err?.message,
        });
      }
      return { received: true };
    });
  }

  /** Beem delivery reports (tolerant field naming). */
  @Public()
  @Post('beem')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async beem(@Body() body: Record<string, any>) {
    await this.tracing.traceCall('webhook.beem', 'webhooks', async (span) => {
      span.event('raw-payload', body);
      const requestId = String(body?.requestId ?? body?.request_id ?? '');
      const dest = String(body?.destAddr ?? body?.dest_addr ?? '');
      if (!requestId || !dest) return;
      const status = String(body?.status ?? '').toUpperCase();
      const sms = await (this.txnStatus as any).prisma.smsMessage.findFirst({
        where: { providerRequestId: requestId },
      });
      if (!sms) return;
      const recipients = Array.isArray(sms.recipients) ? [...sms.recipients] : [];
      const updated = recipients.map((r: any) =>
        String(r.destAddr) === dest ? { ...r, status, reportedAt: new Date().toISOString() } : r,
      );
      const allDelivered = updated.every((r: any) => String(r.status).toUpperCase() === 'DELIVERED');
      await (this.txnStatus as any).prisma.smsMessage.update({
        where: { id: sms.id },
        data: {
          recipients: updated,
          status: allDelivered ? 'DELIVERED' : status === 'FAILED' ? 'FAILED' : sms.status,
          deliveredAt: allDelivered ? new Date() : sms.deliveredAt,
        },
      });
    });
    return { received: true };
  }
}
