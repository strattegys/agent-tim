-- Usage / cost metering for King and ops dashboards.
-- Run from repo (example):
--   cd web && npm run db:exec -- scripts/migrate-usage-events.sql

SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

CREATE TABLE IF NOT EXISTS "_usage_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "occurredAt" timestamptz NOT NULL DEFAULT now(),
  "application" text NOT NULL,
  "surface" text NOT NULL,
  "provider" text NOT NULL,
  "model" text,
  "agentId" text,
  "inputTokens" integer,
  "outputTokens" integer,
  "ttsCharacters" integer,
  "estimatedUsd" numeric(14, 6),
  "requestId" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS "idx_usage_event_occurredAt" ON "_usage_event" ("occurredAt");
CREATE INDEX IF NOT EXISTS "idx_usage_event_app_surface" ON "_usage_event" ("application", "surface");
CREATE INDEX IF NOT EXISTS "idx_usage_event_provider" ON "_usage_event" ("provider");
