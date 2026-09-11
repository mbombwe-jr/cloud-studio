import { Module } from '@nestjs/common';
import { WalletController, AdminWalletController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [AccountsModule],
  controllers: [WalletController, AdminWalletController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
