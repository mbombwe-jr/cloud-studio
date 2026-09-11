import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClickPesaClient } from './clickpesa.client';
import { MockCollectionProvider, MockPayoutProvider } from '../providers/mock.providers';
import { COLLECTION_PROVIDER, PAYOUT_PROVIDER } from '../providers/provider.types';

/**
 * Provides the collection & payout provider implementations.
 * MOCK_PROVIDERS=true swaps ClickPesa for deterministic mocks (dev/tests).
 */
@Global()
@Module({
  providers: [
    ClickPesaClient,
    MockCollectionProvider,
    MockPayoutProvider,
    {
      provide: COLLECTION_PROVIDER,
      inject: [ConfigService, ClickPesaClient, MockCollectionProvider],
      useFactory: (config: ConfigService, real: ClickPesaClient, mock: MockCollectionProvider) =>
        config.get('mockProviders') ? mock : real,
    },
    {
      provide: PAYOUT_PROVIDER,
      inject: [ConfigService, ClickPesaClient, MockPayoutProvider],
      useFactory: (config: ConfigService, real: ClickPesaClient, mock: MockPayoutProvider) =>
        config.get('mockProviders') ? mock : real,
    },
  ],
  exports: [COLLECTION_PROVIDER, PAYOUT_PROVIDER, MockCollectionProvider, MockPayoutProvider],
})
export class ClickPesaModule {}
