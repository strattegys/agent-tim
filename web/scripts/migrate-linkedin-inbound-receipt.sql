-- Idempotent LinkedIn inbound: one row per Unipile message / synthetic id (webhook + replay).
-- Run: npm run db:exec -- scripts/migrate-linkedin-inbound-receipt.sql
-- Deploy: piped via docker compose exec -T crm-db psql (same search_path as other CRM migrations).

SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

CREATE TABLE IF NOT EXISTS "_linkedin_inbound_receipt" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "personId" uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  "unipileMessageId" text NOT NULL,
  "chatId" text NOT NULL DEFAULT '',
  "eventKind" text NOT NULL DEFAULT 'message',
  "senderProviderId" text,
  "senderDisplayName" text,
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_linkedin_inbound_receipt_message UNIQUE ("unipileMessageId")
);

CREATE INDEX IF NOT EXISTS idx_linkedin_inbound_receipt_person
  ON "_linkedin_inbound_receipt" ("personId");

COMMENT ON TABLE "_linkedin_inbound_receipt" IS 'Dedupes LinkedIn inbound webhooks/replays by Unipile message id; ties to Postgres person.';
