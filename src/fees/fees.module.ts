import { Global, Module } from '@nestjs/common';
import { FeesService } from './fees.service';
import { AdminFeeController } from './admin-fees.controller';

/** Fees are consumed by collections, disbursements, wallets and settlements. */
@Global()
@Module({
  controllers: [AdminFeeController],
  providers: [FeesService],
  exports: [FeesService],
})
export class FeesModule {}
