-- Add persisted human-queue flag on workflow items (board requiresHuman → humanTaskOpen).
-- Requires PostgreSQL 11+ (ADD COLUMN IF NOT EXISTS).
-- Run: cd web && npm run db:exec -- scripts/migrate-workflow-item-human-task-open.sql

SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6", public;

ALTER TABLE "_workflow_item" ADD COLUMN IF NOT EXISTS "humanTaskOpen" boolean NOT NULL DEFAULT false;

UPDATE "_workflow_item" wi
SET "humanTaskOpen" = EXISTS (
  SELECT 1
  FROM "_workflow" w
  JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
  CROSS JOIN LATERAL jsonb_array_elements(b.stages::jsonb) AS st
  WHERE w.id = wi."workflowId"
    AND w."deletedAt" IS NULL
    AND UPPER(TRIM(st->>'key')) = UPPER(TRIM(wi.stage::text))
    AND COALESCE((st->>'requiresHuman')::boolean, false) = true
)
WHERE wi."deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_item_human_task_open
  ON "_workflow_item" ("workflowId")
  WHERE "deletedAt" IS NULL AND "humanTaskOpen" = true;
