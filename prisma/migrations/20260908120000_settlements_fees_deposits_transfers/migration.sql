-- CreateEnum
CREATE TYPE "SettlementType" AS ENUM ('MOBILE', 'BANK');

-- CreateEnum
CREATE TYPE "MobileMethod" AS ENUM ('AIRTEL', 'TIGO', 'VODACOM', 'HALOPESA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WalletTxType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "WalletTxType" ADD VALUE 'TRANSFER_IN';

-- AlterEnum
ALTER TYPE "WebhookEvent" ADD VALUE 'DEPOSIT_STATUS';

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "autoSweep" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "collections" ADD COLUMN     "feeAmount" DECIMAL(20,2),
ADD COLUMN     "feeBps" INTEGER;

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "feeAmount" DECIMAL(20,2),
ADD COLUMN     "feeBps" INTEGER,
ADD COLUMN     "payoutKind" TEXT NOT NULL DEFAULT 'CUSTOMER',
ADD COLUMN     "sourceWallet" "WalletType" NOT NULL DEFAULT 'DISBURSEMENT';

-- CreateTable
CREATE TABLE "settlement_accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "SettlementType" NOT NULL,
    "method" "MobileMethod",
    "phoneNumber" TEXT,
    "bankName" TEXT,
    "bankInitials" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_configs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "collectionBelowBps" INTEGER NOT NULL DEFAULT 500,
    "collectionThreshold" DECIMAL(20,2) NOT NULL DEFAULT 3000,
    "collectionAboveBps" INTEGER NOT NULL DEFAULT 200,
    "disbursementBelowBps" INTEGER NOT NULL DEFAULT 500,
    "disbursementThreshold" DECIMAL(20,2) NOT NULL DEFAULT 3000,
    "disbursementAboveBps" INTEGER NOT NULL DEFAULT 200,
    "transferBps" INTEGER NOT NULL DEFAULT 200,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "clientReference" TEXT,
    "channel" "CollectionChannel" NOT NULL DEFAULT 'MOBILE_MONEY',
    "provider" TEXT NOT NULL DEFAULT 'CLICKPESA',
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "phoneNumber" TEXT NOT NULL,
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "providerTxId" TEXT,
    "providerStatus" TEXT,
    "paymentReference" TEXT,
    "collectedAmount" DECIMAL(65,30),
    "collectedCurrency" TEXT,
    "message" TEXT,
    "failureReason" TEXT,
    "customer" JSONB,
    "walletCreditedAt" TIMESTAMP(3),
    "rawRequest" JSONB,
    "rawResponse" JSONB,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transfers" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "clientReference" TEXT,
    "amount" DECIMAL(20,2) NOT NULL,
    "feeAmount" DECIMAL(20,2) NOT NULL,
    "feeBps" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "status" "TxStatus" NOT NULL DEFAULT 'SUCCESS',
    "failureReason" TEXT,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlement_accounts_accountId_idx" ON "settlement_accounts"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_configs_accountId_key" ON "fee_configs"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_reference_key" ON "deposits"("reference");

-- CreateIndex
CREATE INDEX "deposits_accountId_createdAt_idx" ON "deposits"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "deposits_status_idx" ON "deposits"("status");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transfers_reference_key" ON "wallet_transfers"("reference");

-- CreateIndex
CREATE INDEX "wallet_transfers_accountId_createdAt_idx" ON "wallet_transfers"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "settlement_accounts" ADD CONSTRAINT "settlement_accounts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_configs" ADD CONSTRAINT "fee_configs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transfers" ADD CONSTRAINT "wallet_transfers_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

