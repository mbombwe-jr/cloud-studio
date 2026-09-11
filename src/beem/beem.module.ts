import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BeemClient } from './beem.client';
import { MockSmsProvider } from '../providers/mock.providers';
import { SMS_PROVIDER } from '../providers/provider.types';

@Global()
@Module({
  providers: [
    BeemClient,
    MockSmsProvider,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, BeemClient, MockSmsProvider],
      useFactory: (config: ConfigService, real: BeemClient, mock: MockSmsProvider) =>
        config.get('mockProviders') ? mock : real,
    },
  ],
  exports: [SMS_PROVIDER, MockSmsProvider],
})
export class BeemModule {}
