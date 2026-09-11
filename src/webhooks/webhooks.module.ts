import { Module, OnModuleInit } from '@nestjs/common';
import { WalletsModule } from '../wallets/wallets.module';
import { WebhookEndpointsService } from './webhooks.service';
import { TxnStatusService } from './txn-status.service';
import { WebhookReceiverController } from './webhook-receiver.controller';
import { WebhookSelfController } from './webhooks-self.controller';
import { IiiQueueService } from '../iii/queue.service';
import { IiiCronService } from '../iii/cron.service';

@Module({
  imports: [WalletsModule],
  controllers: [WebhookReceiverController, WebhookSelfController],
  providers: [WebhookEndpointsService, TxnStatusService],
  exports: [WebhookEndpointsService, TxnStatusService],
})
export class WebhooksModule implements OnModuleInit {
  constructor(
    private readonly endpoints: WebhookEndpointsService,
    private readonly queue: IiiQueueService,
    private readonly cron: IiiCronService,
  ) {}

  onModuleInit() {
    this.queue.register('webhook.deliver', (payload: { deliveryId: string }) => this.endpoints.deliverJob(payload), { maxAttempts: 6 });
    // safety net: re-enqueue any due retries whose delayed job was lost
    this.cron.register('webhook-retry-sweep', '0 */5 * * * *', () => this.endpoints.sweepDueRetries());
  }
}
