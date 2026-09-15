import { Module, OnModuleInit } from '@nestjs/common';
import { WalletsModule } from '../wallets/wallets.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { DisbursementsController } from './disbursements.controller';
import { PayoutLinksController } from './payout-links.controller';
import { DisbursementsService } from './disbursements.service';
import { IiiCronService } from '../iii/cron.service';
import { IiiQueueService } from '../iii/queue.service';

@Module({
  imports: [WalletsModule, WebhooksModule],
  controllers: [DisbursementsController, PayoutLinksController],
  providers: [DisbursementsService],
  exports: [DisbursementsService],
})
export class DisbursementsModule implements OnModuleInit {
  constructor(
    private readonly disbursements: DisbursementsService,
    private readonly queue: IiiQueueService,
    private readonly cron: IiiCronService,
  ) {}

  onModuleInit(): void {
    this.queue.register('payout.process', (payload: { payoutId: string }) => this.disbursements.processPayoutJob(payload));
    this.queue.register('batch.process', (payload: { batchId: string; payoutIds: string[] }) => this.disbursements.processBatchJob(payload));
    this.cron.register('payout-status-poll', '30 */1 * * * *', async () => {
      try {
        await this.disbursements.pollPending();
      } catch {
        /* logged inside */
      }
    });
  }
}
