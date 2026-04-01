-- Unipile message time (when the provider says the message/event occurred), not row insert time.
-- Run: npm run db:exec -- scripts/migrate-linkedin-inbound-receipt-message-sent-at.sql

SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

ALTER TABLE "_linkedin_inbound_receipt"
  ADD COLUMN IF NOT EXISTS "messageSentAt" timestamptz;

COMMENT ON COLUMN "_linkedin_inbound_receipt"."messageSentAt" IS 'Unipile payload.timestamp (when the message or connection event occurred). NULL on legacy rows = use createdAt.';

UPDATE "_linkedin_inbound_receipt"
SET "messageSentAt" = "createdAt"
WHERE "messageSentAt" IS NULL;
