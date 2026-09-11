import { Module, OnModuleInit } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';
import { IiiCronService } from '../iii/cron.service';
import { IiiQueueService } from '../iii/queue.service';

@Module({
  imports: [WebhooksModule],
  controllers: [SmsController],
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule implements OnModuleInit {
  constructor(
    private readonly sms: SmsService,
    private readonly queue: IiiQueueService,
    private readonly cron: IiiCronService,
  ) {}

  onModuleInit(): void {
    this.queue.register('sms.send', (payload: { smsId: string }) => this.sms.processSendJob(payload));
    // delivery reports become meaningful ~5 minutes after submission
    this.cron.register('sms-delivery-sync', '0 */10 * * * *', async () => {
      try {
        await this.sms.syncDeliveryReports();
      } catch {
        /* logged inside */
      }
    });
  }
}
