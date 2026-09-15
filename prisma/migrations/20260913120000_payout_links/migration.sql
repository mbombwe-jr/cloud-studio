CREATE TABLE "payout_links" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "recipientPhone" TEXT,
    "payoutMethod" TEXT,
    "beneficiaryName" TEXT,
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payout_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payout_links_tokenHash_key" ON "payout_links"("tokenHash");
CREATE UNIQUE INDEX "payout_links_payoutId_key" ON "payout_links"("payoutId");
CREATE INDEX "payout_links_accountId_createdAt_idx" ON "payout_links"("accountId", "createdAt");
CREATE INDEX "payout_links_expiresAt_idx" ON "payout_links"("expiresAt");
ALTER TABLE "payout_links" ADD CONSTRAINT "payout_links_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payout_links" ADD CONSTRAINT "payout_links_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
