import { Module, OnModuleInit } from '@nestjs/common';
import { BillingService } from './billing.service';
import { AdminBillingController } from './billing.controller';
import { IiiCronService } from '../iii/cron.service';

@Module({
  controllers: [AdminBillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule implements OnModuleInit {
  constructor(private readonly billing: BillingService, private readonly cron: IiiCronService) {}

  onModuleInit(): void {
    // Recurring subscription bills (02:07 daily, Africa/Dar_es_Salaam).
    // NOTE: unpaid bills never auto-suspend accounts — suspension is admin-only.
    this.cron.register('recurring-billing', '0 7 2 * * *', async () => {
      try {
        await this.billing.runRecurringBilling();
      } catch {
        /* logged upstream */
      }
    });
  }
}
