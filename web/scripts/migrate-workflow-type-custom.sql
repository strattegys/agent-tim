-- Custom workflow type definitions (merge with WORKFLOW_TYPES in code at runtime).
-- Run from repo: pipe into psql or npm run db:exec -- scripts/migrate-workflow-type-custom.sql

SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6", public;

CREATE TABLE IF NOT EXISTS "_workflow_type_custom" (
  "id"             text PRIMARY KEY,
  "label"          text NOT NULL,
  "itemType"       text NOT NULL CHECK ("itemType" IN ('person', 'content')),
  "description"    text NOT NULL DEFAULT '',
  "defaultBoard"   jsonb NOT NULL DEFAULT '{"stages":[],"transitions":{}}',
  "throughputGoal" jsonb,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  "deletedAt"      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_workflow_type_custom_active
  ON "_workflow_type_custom" ("id") WHERE "deletedAt" IS NULL;
