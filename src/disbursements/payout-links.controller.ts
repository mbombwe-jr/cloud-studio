import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../common/decorators/auth.decorators';
import { PayoutLinkDetailsDto } from './dto/disbursement.dto';
import { DisbursementsService } from './disbursements.service';

/** Public recipient surface. Possession of the high-entropy token is the credential. */
@Public()
@Controller('payout-links')
export class PayoutLinksController {
  constructor(private readonly disbursements: DisbursementsService) {}

  @Get(':token')
  details(@Param('token') token: string) {
    return this.disbursements.getPayoutLink(token);
  }

  @Post(':token/recipient')
  recipient(@Param('token') token: string, @Body() dto: PayoutLinkDetailsDto) {
    return this.disbursements.resolvePayoutLinkRecipient(token, dto);
  }

  @Post(':token/confirm')
  confirm(@Param('token') token: string, @Body() dto: PayoutLinkDetailsDto, @Req() req: Request & { traceId?: string }) {
    return this.disbursements.confirmPayoutLink(token, dto, req.traceId);
  }
}
