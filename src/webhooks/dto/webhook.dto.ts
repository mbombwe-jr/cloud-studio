import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { WebhookEvent } from '@prisma/client';

export class UpsertWebhookDto {
  @IsUrl({ require_tld: false }, { message: 'url must be a valid callback URL' })
  url!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(Object.values(WebhookEvent), { each: true })
  events!: WebhookEvent[];
}

export class CreateWebhookDto extends UpsertWebhookDto {}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  @IsOptional()
  @IsArray()
  @IsIn(Object.values(WebhookEvent), { each: true })
  events?: WebhookEvent[];

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  _touch?: string;
}
