import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AdminAccountsController, AccountSelfController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { PaginationMiddleware } from '../common/pagination.middleware';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [AccountSelfController, AdminAccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(PaginationMiddleware).forRoutes('admin/accounts');
  }
}
