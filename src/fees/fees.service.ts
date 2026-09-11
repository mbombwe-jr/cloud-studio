import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCodes } from '../common/constants';

export type FeeKind = 'COLLECTION' | 'DISBURSEMENT';

export interface ComputedFee {
  feeAmount: string;
  feeBps: number;
  thresholdApplied: 'BELOW' | 'ABOVE';
}

/**
 * Per-customer custom fees (requirement #3).
 *
 * Defaults (used whenever an account has no explicit overrides):
 *  - 5% (500 bps) for transactions strictly below TZS 3,000
 *  - 2% (200 bps) for transactions at/above TZS 3,000
 *  - identical tiers for collection and disbursement
 *  - wallet transfer (collection -> disbursement) defaults to 2% (200 bps)
 *
 * The config row is created lazily on first read, so every account always
 * has an effective fee schedule without a seeding dependency.
 */
@Injectable()
export class FeesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Fetches the account's fee config, creating the default row on demand. */
  async getConfig(accountId: string) {
    const existing = await this.prisma.feeConfig.findUnique({ where: { accountId } });
    if (existing) return existing;
    try {
      return await this.prisma.feeConfig.create({ data: { accountId } });
    } catch {
      // concurrent create — re-read
      const row = await this.prisma.feeConfig.findUnique({ where: { accountId } });
      if (!row) throw new NotFoundException({ code: ErrorCodes.NOT_FOUND, message: 'Fee config not found' });
      return row;
    }
  }

  async updateConfig(
    accountId: string,
    patch: Partial<{
      collectionBelowBps: number;
      collectionThreshold: string;
      collectionAboveBps: number;
      disbursementBelowBps: number;
      disbursementThreshold: string;
      disbursementAboveBps: number;
      transferBps: number;
    }>,
  ) {
    await this.getConfig(accountId);
    const data: Prisma.FeeConfigUpdateInput = {};
    const bounds: Array<[number | undefined, string]> = [
      [patch.collectionBelowBps, 'collectionBelowBps'],
      [patch.collectionAboveBps, 'collectionAboveBps'],
      [patch.disbursementBelowBps, 'disbursementBelowBps'],
      [patch.disbursementAboveBps, 'disbursementAboveBps'],
      [patch.transferBps, 'transferBps'],
    ];
    for (const [value, key] of bounds) {
      if (value !== undefined) {
        if (!Number.isInteger(value) || value < 0 || value > 10000) {
          throw new NotFoundException({ code: ErrorCodes.VALIDATION_FAILED, message: `${key} must be an integer between 0 and 10000 bps` });
        }
        (data as any)[key] = value;
      }
    }
    if (patch.collectionThreshold !== undefined) data.collectionThreshold = new Prisma.Decimal(patch.collectionThreshold);
    if (patch.disbursementThreshold !== undefined) data.disbursementThreshold = new Prisma.Decimal(patch.disbursementThreshold);
    return this.prisma.feeConfig.update({ where: { accountId }, data });
  }

  /**
   * Computes the platform fee for a collection/disbursement transaction.
   * Below the tier threshold -> belowBps; at/above -> aboveBps.
   */
  async computeFee(kind: FeeKind, accountId: string, amount: string | number | Prisma.Decimal): Promise<ComputedFee> {
    const config = await this.getConfig(accountId);
    const value = new Prisma.Decimal(amount);
    const threshold = kind === 'COLLECTION' ? config.collectionThreshold : config.disbursementThreshold;
    const belowBps = kind === 'COLLECTION' ? config.collectionBelowBps : config.disbursementBelowBps;
    const aboveBps = kind === 'COLLECTION' ? config.collectionAboveBps : config.disbursementAboveBps;
    const isBelow = value.lessThan(threshold);
    const feeBps = isBelow ? belowBps : aboveBps;
    const feeAmount = value.mul(feeBps).div(10000).toFixed(2);
    return { feeAmount, feeBps, thresholdApplied: isBelow ? 'BELOW' : 'ABOVE' };
  }

  /** Transfer fee (collection -> disbursement wallet move), default 2%. */
  async computeTransferFee(accountId: string, amount: string | number | Prisma.Decimal): Promise<ComputedFee> {
    const config = await this.getConfig(accountId);
    const value = new Prisma.Decimal(amount);
    const feeAmount = value.mul(config.transferBps).div(10000).toFixed(2);
    return { feeAmount, feeBps: config.transferBps, thresholdApplied: 'ABOVE' };
  }
}
