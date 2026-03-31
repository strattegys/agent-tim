-- Track whether webhook processing finished after dedupe claim (avoids "stuck" receipts that block replay).
-- Run: npm run db:exec -- scripts/migrate-linkedin-inbound-receipt-outcome.sql

SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

ALTER TABLE "_linkedin_inbound_receipt"
  ADD COLUMN IF NOT EXISTS "processedAt" timestamptz NULL;

ALTER TABLE "_linkedin_inbound_receipt"
  ADD COLUMN IF NOT EXISTS "processNote" text NULL;

COMMENT ON COLUMN "_linkedin_inbound_receipt"."processedAt" IS 'Set when handleUnipileWebhook finished routing (ok or failed). NULL = still in flight or pre-migration row.';
COMMENT ON COLUMN "_linkedin_inbound_receipt"."processNote" IS 'Error or route hint when processing did not fully apply workflow/inbox updates.';

-- Historical rows: assume delivery completed before we tracked outcomes (prevents false orphan floods).
UPDATE "_linkedin_inbound_receipt"
SET "processedAt" = COALESCE("processedAt", "createdAt"),
    "processNote" = COALESCE("processNote", 'legacy_pre_outcome_tracking')
WHERE "processedAt" IS NULL;
