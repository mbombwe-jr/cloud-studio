import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { IiiModule } from './iii/iii.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AccountsModule } from './accounts/accounts.module';
import { WalletsModule } from './wallets/wallets.module';
import { FeesModule } from './fees/fees.module';
import { SettlementsModule } from './settlements/settlements.module';
import { DepositsModule } from './deposits/deposits.module';
import { ClickPesaModule } from './clickpesa/clickpesa.module';
import { BeemModule } from './beem/beem.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { CollectionsModule } from './collections/collections.module';
import { DisbursementsModule } from './disbursements/disbursements.module';
import { SmsModule } from './sms/sms.module';
import { BillingModule } from './billing/billing.module';
import { AdminModule } from './admin/admin.module';
import { HealthController } from './health/health.controller';
import { PaginationMiddleware } from './common/pagination.middleware';

/**
 * Zoostudios — secure multi-service provisioning backend.
 * Services: money collection, money disbursement (single + batch), SMS.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], cache: true }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        { ttl: config.get('throttle.ttl', 60000), limit: config.get('throttle.limit', 120) },
      ],
    }),
    PrismaModule,
    IiiModule,
    AuditModule,
    AuthModule,
    AccountsModule,
    WalletsModule,
    FeesModule,
    SettlementsModule,
    DepositsModule,
    ClickPesaModule,
    BeemModule,
    WebhooksModule,
    CollectionsModule,
    DisbursementsModule,
    SmsModule,
    BillingModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(PaginationMiddleware).forRoutes('admin', 'collections', 'disbursements', 'sms', 'wallets');
  }
}
