import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient, SmsStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Inject } from '@nestjs/common';
import { SMS_PROVIDER } from '../providers/provider.types';
import { SmsProvider } from '../providers/provider.types';
import { WebhookEndpointsService } from '../webhooks/webhooks.service';
import { buildReference } from '../common/utils/reference.util';
import { normalizePhoneNumber } from '../common/utils/phone.util';
import { ErrorCodes } from '../common/constants';
import { IiiAnalyticsService } from '../iii/analytics.service';
import { IiiLoggerService } from '../iii/logger.service';
import { IiiQueueService } from '../iii/queue.service';
import { IiiTracingService } from '../iii/tracing.service';

/**
 * SMS sending via Beem Africa with shared or dedicated sender names.
 * Flow: validate -> persist (QUEUED) -> queue -> provider -> SENT -> delivery
 * reports (provider DLR endpoint + inbound webhook) -> DELIVERED.
 */
@Injectable()
export class SmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly webhooks: WebhookEndpointsService,
    private readonly analytics: IiiAnalyticsService,
    private readonly queue: IiiQueueService,
    private readonly tracing: IiiTracingService,
    private readonly logger: IiiLoggerService,
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
  ) {}

  async send(
    accountId: string,
    dto: { senderName?: string; message: string; recipients: string[]; scheduleAt?: string },
    traceId?: string,
  ) {
    return this.tracing.traceCall('sms.send', 'sms', async (span) => {
      const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { sourceCode: true, accountName: true } });
      if (!account) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Account not found' });

      // normalize + dedupe recipients
      const normalized = dto.recipients
        .map((r) => normalizePhoneNumber(r))
        .filter((r): r is string => Boolean(r));
      if (normalized.length === 0) {
        throw new BadRequestException({ code: ErrorCodes.VALIDATION_FAILED, message: 'No valid recipient numbers after normalization' });
      }
      const unique = Array.from(new Set(normalized));
      span.event('recipients', { count: unique.length });

      // resolve sender name (dedicated first, then shared, then platform default)
      const senderName = await this.resolveSender(accountId, dto.senderName);

      const reference = buildReference(account.sourceCode);
      const recipientsPayload = unique.map((dest, idx) => ({ recipientId: idx + 1, destAddr: dest, status: 'PENDING' }));

      const sms = await this.prisma.smsMessage.create({
        data: {
          accountId,
          reference,
          senderName,
          message: dto.message,
          encoding: 0,
          recipients: recipientsPayload as Prisma.InputJsonValue,
          recipientCount: unique.length,
          status: SmsStatus.QUEUED,
          scheduledAt: dto.scheduleAt ? new Date(dto.scheduleAt) : null,
          traceId: traceId ?? this.tracing.currentTraceId(),
        },
      });

      // pay-as-you-go billing (auto bill per send when configured)
      await this.maybeIssuePaygBill(accountId, unique.length, reference);

      await this.queue.enqueue('sms.send', { smsId: sms.id, traceId: sms.traceId });
      this.analytics.track('sms.sent', { accountId, traceId: sms.traceId ?? undefined, dimensions: { recipients: unique.length, senderName } });

      return sms;
    });
  }

  private async resolveSender(accountId: string, requested?: string): Promise<string> {
    const defaultSender = this.config.get<string>('sms.defaultSender', 'ZOOINFO');
    if (requested) {
      const dedicated = await this.prisma.senderName.findFirst({ where: { accountId, name: requested.toUpperCase(), type: 'DEDICATED', isApproved: true } });
      if (dedicated) return requested.toUpperCase();
      const shared = await this.prisma.senderName.findFirst({ where: { accountId: null, name: requested.toUpperCase(), type: 'SHARED', isApproved: true } });
      if (shared) return requested.toUpperCase();
      throw new ForbiddenException({
        code: ErrorCodes.INVALID_SENDER,
        message: `Sender name "${requested}" is not approved for this account (dedicated or shared senders only)`,
      });
    }
    // no explicit sender: prefer the account's single dedicated sender, else platform default
    const dedicated = await this.prisma.senderName.findFirst({ where: { accountId, type: 'DEDICATED', isApproved: true } });
    return dedicated?.name ?? defaultSender;
  }

  private async maybeIssuePaygBill(accountId: string, recipients: number, reference: string): Promise<void> {
    const permission = await this.prisma.servicePermission.findUnique({
      where: { accountId_service: { accountId, service: 'SMS' } },
    });
    if (!permission?.granted || (permission.meta as any)?.payAsYouGo !== true) return;
    const rate = this.config.get<number>('sms.rateTzs', 20);
    await this.prisma.bill.create({
      data: {
        accountId,
        type: 'PAY_AS_YOU_GO',
        title: `SMS usage (${reference})`,
        description: `${recipients} recipient(s) at ${rate} TZS each`,
        amount: new Prisma.Decimal(rate).mul(recipients),
        currency: 'TZS',
        metadata: { smsReference: reference, recipients, rate } as Prisma.InputJsonValue,
      },
    });
  }

  /** Queue handler: performs the provider call. */
  async processSendJob(payload: { smsId: string }): Promise<void> {
    // Recover claims abandoned by a crashed/restarted process (>10 min old).
    await this.prisma.smsMessage.updateMany({
      where: { status: SmsStatus.PROCESSING, updatedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
      data: { status: SmsStatus.QUEUED },
    });

    const sms = await this.prisma.smsMessage.findUnique({ where: { id: payload.smsId } });
    if (!sms || sms.status === SmsStatus.SENT || sms.status === SmsStatus.DELIVERED) return;

    // Idempotency claim: atomically move the message out of QUEUED/FAILED so a
    // redelivered or concurrent job can never submit it to the provider twice.
    const claim = await this.prisma.smsMessage.updateMany({
      where: { id: sms.id, status: { in: [SmsStatus.QUEUED, SmsStatus.FAILED] } },
      data: { status: SmsStatus.PROCESSING },
    });
    if (claim.count === 0) return; // already claimed / already sent

    const recipients = (sms.recipients as any[]).map((r) => ({ recipientId: r.recipientId, destAddr: r.destAddr }));
    const result = await this.provider.send({
      source_addr: sms.senderName,
      message: sms.message,
      encoding: sms.encoding,
      recipients,
      ...(sms.scheduledAt
        ? { schedule_time: sms.scheduledAt.toISOString().slice(0, 16).replace('T', ' ') }
        : {}),
    });

    const recipientsWithResult = (sms.recipients as any[]).map((r) => ({
      ...r,
      status: result.ok ? 'SUBMITTED' : 'FAILED',
      error: result.ok ? undefined : result.error,
    }));

    if (result.ok && result.data) {
      // cost = rate TZS x segments x recipients (GSM7: 160 chars/segment, unicode: 70)
      const rate = this.config.get<number>('sms.rateTzs', 20);
      const perSegment = sms.encoding === 1 ? 70 : 160;
      const segments = Math.max(1, Math.ceil((sms.message ?? '').length / perSegment));
      const cost = new Prisma.Decimal(rate).mul(segments).mul(sms.recipientCount);
      // Beem returns request_id as a NUMBER — the column is a String, so cast.
      const providerRequestId = String((result.data as any).request_id ?? '');
      try {
        await this.prisma.smsMessage.update({
          where: { id: sms.id },
          data: {
            status: SmsStatus.SENT,
            providerRequestId,
            sentAt: new Date(),
            cost,
            rawResponse: result.data as unknown as Prisma.InputJsonValue,
            recipients: recipientsWithResult as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (persistErr: any) {
        // The provider ACCEPTED the message. Never rethrow here: a queue retry
        // would re-send the SMS to real recipients (duplicate billing + spam).
        // Try a minimal fallback write so the send is still recorded.
        try {
          await this.prisma.smsMessage.update({
            where: { id: sms.id },
            data: { status: SmsStatus.SENT, providerRequestId, sentAt: new Date(), cost },
          });
        } catch {
          /* leave PROCESSING; stale-claim recovery + delivery sync reconcile later */
        }
        this.logger.error(
          `sms post-send persistence failed (message WAS submitted, retry suppressed): ${persistErr?.message}`,
          { module: 'sms', smsId: sms.id, reference: sms.reference },
        );
      }
      await this.webhooks.dispatch('SMS_STATUS', sms.accountId, sms.reference, {
        status: 'SENT', reference: sms.reference, senderName: sms.senderName,
        recipientCount: sms.recipientCount, providerRequestId,
      }, sms.traceId ?? undefined);
    } else {
      // Provider did NOT accept — safe to let the queue retry.
      await this.prisma.smsMessage.update({
        where: { id: sms.id },
        data: { status: SmsStatus.FAILED, failureReason: result.error, recipients: recipientsWithResult as unknown as Prisma.InputJsonValue },
      });
      this.analytics.track('sms.failed', { accountId: sms.accountId, traceId: sms.traceId ?? undefined });
      throw new Error(result.error ?? 'SMS provider rejected the message'); // let the queue retry
    }
  }

  /** Cron: pull delivery reports for recently sent messages. */
  async syncDeliveryReports(): Promise<void> {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const sent = await this.prisma.smsMessage.findMany({
      where: { status: SmsStatus.SENT, sentAt: { lte: cutoff }, providerRequestId: { not: null } },
      take: 25,
      orderBy: { sentAt: 'asc' },
    });
    for (const sms of sent) {
      const recipients = (sms.recipients as any[]).filter((r) => String(r.status) !== 'DELIVERED').slice(0, 20);
      let anyFailed = false;
      const updatedRecipients = [...(sms.recipients as any[])];
      for (const r of recipients) {
        const report = await this.provider.deliveryReport(sms.providerRequestId!, r.destAddr);
        if (report.ok && report.data) {
          const status = String(report.data.status ?? 'UNKNOWN').toUpperCase();
          const idx = updatedRecipients.findIndex((x) => x.destAddr === r.destAddr);
          if (idx >= 0) updatedRecipients[idx] = { ...updatedRecipients[idx], status, reportedAt: new Date().toISOString() };
          if (status === 'DELIVERED') this.analytics.track('sms.delivered', { accountId: sms.accountId, traceId: sms.traceId ?? undefined });
          if (status === 'FAILED') anyFailed = true;
        }
      }
      const allDelivered = updatedRecipients.every((r) => String(r.status).toUpperCase() === 'DELIVERED');
      const nextStatus = allDelivered ? SmsStatus.DELIVERED : anyFailed ? SmsStatus.FAILED : sms.status;
      await this.prisma.smsMessage.update({
        where: { id: sms.id },
        data: {
          recipients: updatedRecipients as unknown as Prisma.InputJsonValue,
          status: nextStatus,
          deliveredAt: allDelivered ? new Date() : sms.deliveredAt,
        },
      });
      if (nextStatus !== sms.status) {
        await this.webhooks.dispatch('SMS_STATUS', sms.accountId, sms.reference, {
          status: nextStatus, reference: sms.reference, senderName: sms.senderName,
        }, sms.traceId ?? undefined);
      }
    }
  }

  async get(accountId: string, reference: string) {
    const sms = await this.prisma.smsMessage.findFirst({ where: { reference, accountId } });
    if (!sms) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: `SMS ${reference} not found` });
    return sms;
  }

  async list(accountId: string, params: { skip: number; take: number; status?: string }) {
    const where: Prisma.SmsMessageWhereInput = {
      accountId,
      ...(params.status ? { status: params.status.toUpperCase() as SmsStatus } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.smsMessage.findMany({ where, orderBy: { createdAt: 'desc' }, skip: params.skip, take: params.take }),
      this.prisma.smsMessage.count({ where }),
    ]);
    return { items, total };
  }

  /** Sender names available to the account (dedicated + shared). */
  async senderNames(accountId: string) {
    const [dedicated, shared] = await this.prisma.$transaction([
      this.prisma.senderName.findMany({ where: { accountId, type: 'DEDICATED' } }),
      this.prisma.senderName.findMany({ where: { accountId: null, type: 'SHARED' } }),
    ]);
    return {
      dedicated: dedicated.map((s) => ({ id: s.id, name: s.name, isApproved: s.isApproved })),
      shared: shared.map((s) => ({ id: s.id, name: s.name, isApproved: s.isApproved })),
    };
  }
}
