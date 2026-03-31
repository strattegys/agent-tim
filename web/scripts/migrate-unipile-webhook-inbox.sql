-- Durable queue for Unipile POST payloads: survive restarts and process when CRM is back.
-- Run: npm run db:exec -- scripts/migrate-unipile-webhook-inbox.sql

SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

CREATE TABLE IF NOT EXISTS "_unipile_webhook_inbox" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload jsonb NOT NULL,
  "receivedAt" timestamptz NOT NULL DEFAULT NOW(),
  "processedAt" timestamptz NULL,
  "lockedAt" timestamptz NULL,
  attempts int NOT NULL DEFAULT 0,
  "processNote" text NULL
);

CREATE INDEX IF NOT EXISTS idx_unipile_webhook_inbox_pending
  ON "_unipile_webhook_inbox" ("receivedAt" ASC)
  WHERE "processedAt" IS NULL;

COMMENT ON TABLE "_unipile_webhook_inbox" IS 'Unipile webhook bodies persisted before HTTP 200; drained by cron and post-enqueue async.';
