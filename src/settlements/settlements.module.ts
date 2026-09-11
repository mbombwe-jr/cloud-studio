import { Module, OnModuleInit } from '@nestjs/common';
import { SettlementsService } from './settlements.service';
import { AdminSettlementController } from './settlements.controller';
import { WalletSettlementController } from './wallet-settlement.controller';
import { WalletsModule } from '../wallets/wallets.module';
import { IiiCronService } from '../iii/cron.service';

@Module({
  imports: [WalletsModule],
  controllers: [AdminSettlementController, WalletSettlementController],
  providers: [SettlementsService],
  exports: [SettlementsService],
})
export class SettlementsModule implements OnModuleInit {
  constructor(
    private readonly cron: IiiCronService,
    private readonly settlements: SettlementsService,
  ) {}

  /**
   * Auto-sweep (requirement #4): every day at 00:00 Africa/Dar_es_Salaam
   * the collection wallet balance is settled into each eligible account's
   * default settlement account. Explicit timezone so the schedule is
   * correct regardless of the host clock.
   */
  onModuleInit() {
    this.cron.register('auto-sweep', '0 0 0 * * *', async () => {
      await this.settlements.runAutoSweep();
    }, 'Africa/Dar_es_Salaam');
  }
}
