import { Module, OnModuleInit } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { DepositsController } from './deposits.controller';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { IiiCronService } from '../iii/cron.service';

@Module({
  imports: [WebhooksModule],
  controllers: [DepositsController],
  providers: [DepositsService],
  exports: [DepositsService],
})
export class DepositsModule implements OnModuleInit {
  constructor(
    private readonly cron: IiiCronService,
    private readonly deposits: DepositsService,
  ) {}

  /** Cron: poll pending deposits (missed webhooks), same cadence as collections. */
  onModuleInit() {
    this.cron.register('deposit-status-poll', '10 */1 * * * *', async () => {
      await this.deposits.pollPending();
    });
  }
}
