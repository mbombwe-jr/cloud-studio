import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentAccount, RequestAccount } from '../common/decorators/current.decorators';
import { WebhookEndpointsService } from './webhooks.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';

/** Account-facing webhook (callback) endpoint management. */
@ApiTags('webhooks')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('me/webhooks')
export class WebhookSelfController {
  constructor(private readonly webhooks: WebhookEndpointsService) {}

  /** Register a callback endpoint; the signing secret is returned exactly once. */
  @Post()
  create(@CurrentAccount() account: RequestAccount, @Body() dto: CreateWebhookDto) {
    return this.webhooks.create(account.id, dto);
  }

  @Get()
  list(@CurrentAccount() account: RequestAccount) {
    return this.webhooks.list(account.id);
  }

  @Patch(':endpointId')
  update(@CurrentAccount() account: RequestAccount, @Param('endpointId') endpointId: string, @Body() dto: UpdateWebhookDto) {
    return this.webhooks.update(account.id, endpointId, dto);
  }

  @Delete(':endpointId')
  remove(@CurrentAccount() account: RequestAccount, @Param('endpointId') endpointId: string) {
    return this.webhooks.remove(account.id, endpointId);
  }
}
