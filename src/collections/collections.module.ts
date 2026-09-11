import { Module, OnModuleInit } from '@nestjs/common';
import { WalletsModule } from '../wallets/wallets.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { COLLECTION_PROVIDER } from '../providers/provider.types';
import { IiiCronService } from '../iii/cron.service';

@Module({
  imports: [WalletsModule, WebhooksModule],
  controllers: [CollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule implements OnModuleInit {
  constructor(private readonly collections: CollectionsService, private readonly cron: IiiCronService) {}

  onModuleInit(): void {
    // Poll provider for authoritative status of pending collections (missed webhooks)
    this.cron.register('collection-status-poll', '0 */1 * * * *', async () => {
      try {
        await this.collections.pollPending();
      } catch {
        /* logged inside */
      }
    });
  }
}
