-- AlterTable: add nullable `plan` for per-plan revenue attribution.
-- Nullable column with no default = metadata-only change in Postgres (no table
-- rewrite, no long lock), safe to run on the shared DB via `migrate deploy`.
ALTER TABLE "payment_transactions" ADD COLUMN "plan" TEXT;

-- Best-effort backfill of historical rows by matching the charged amount to the
-- canonical USD plan prices. Deliberately conservative: only exact matches on
-- USD (or unspecified currency) are attributed; everything else stays NULL
-- ("unknown") rather than risk a wrong plan. A coupon/promo/localized amount
-- simply won't match and remains NULL, which is the correct, non-misleading
-- outcome. Going forward the column is populated from the store productId at
-- purchase time, so this only affects rows created before this migration.
UPDATE "payment_transactions"
SET "plan" = CASE
    WHEN "amount" = 1.5 THEN 'weekly'
    WHEN "amount" = 4.99 THEN 'monthly'
    WHEN "amount" = 47.99 THEN 'yearly'
    WHEN "amount" = 0 THEN 'free'
END
WHERE "plan" IS NULL
  AND ("currency" = 'USD' OR "currency" IS NULL)
  AND "amount" IN (1.5, 4.99, 47.99, 0);
