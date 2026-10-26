-- Additive: admin-managed FX rates used to report revenue in USD.
-- No rows are inserted here; rates are entered by an admin.
CREATE TABLE IF NOT EXISTS "fx_rates" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rateToUsd" DECIMAL(18,8) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fx_rates_currency_effectiveFrom_key" ON "fx_rates"("currency", "effectiveFrom");

CREATE INDEX IF NOT EXISTS "fx_rates_currency_effectiveFrom_idx" ON "fx_rates"("currency", "effectiveFrom" DESC);
