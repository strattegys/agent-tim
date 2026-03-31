-- APPLY: remove replay noise from production Tim queue (general inbox rows + undo mistaken warm-outreach Replied).
-- Same intent as:
--   - soft-deleting LINKEDIN_INBOUND general-inbox items from replay
--   - POST /api/crm/human-tasks/resolve action undo_replied for warm-outreach rows advanced by replay
--
-- BEFORE RUNNING:
--   1) Run scripts/prune-unipile-replay-prod-preview.sql and confirm rows match what you expect.
--   2) Optionally replace the temp-table INSERTs with explicit UUID lists if you need surgical deletes.
--
-- Run (production CRM credentials / tunnel):
--   cd COMMAND-CENTRAL/web
--   npm run db:exec -- scripts/prune-unipile-replay-prod-apply.sql
--
-- MESSAGED follow-up due date uses 4 days (see lib/warm-outreach-cadence.ts).

BEGIN;

-- ---------------------------------------------------------------------------
-- A) General inbox — snapshot item ids, then soft-delete artifacts + items
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE prune_unipile_gi ON COMMIT DROP AS
SELECT DISTINCT wi.id AS id
FROM "_workflow_item" wi
INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
INNER JOIN "_artifact" a ON a."workflowItemId" = wi.id AND a."deletedAt" IS NULL
WHERE wi."deletedAt" IS NULL
  AND UPPER(TRIM(wi.stage::text)) = 'LINKEDIN_INBOUND'
  AND (
    COALESCE(w.spec::text, '') LIKE '%linkedin-general-inbox%'
    OR COALESCE(w.name, '') ILIKE '%general inbox%'
  )
  AND a.content LIKE '%## LinkedIn — inbound message (general inbox)%'
  AND wi."updatedAt" >= NOW() - INTERVAL '30 days';

UPDATE "_artifact" art
SET
  "deletedAt" = NOW(),
  "updatedAt" = NOW()
WHERE art."workflowItemId" IN (SELECT id FROM prune_unipile_gi)
  AND art."deletedAt" IS NULL;

UPDATE "_workflow_item" wi
SET
  "deletedAt" = NOW(),
  "humanTaskOpen" = false,
  "updatedAt" = NOW()
WHERE wi.id IN (SELECT id FROM prune_unipile_gi)
  AND wi."deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- B) Warm-outreach — snapshot ids, soft-delete REPLIED/REPLY_DRAFT artifacts, restore MESSAGED
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE prune_unipile_wo ON COMMIT DROP AS
SELECT DISTINCT wi.id AS id
FROM "_workflow_item" wi
INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
WHERE wi."deletedAt" IS NULL
  AND UPPER(TRIM(wi.stage::text)) IN ('REPLY_DRAFT', 'REPLIED')
  AND COALESCE(w.spec::text, '') LIKE '%warm-outreach%'
  AND EXISTS (
    SELECT 1
    FROM "_artifact" a
    WHERE a."workflowItemId" = wi.id
      AND a."deletedAt" IS NULL
      AND a.content LIKE '%## LinkedIn inbound (Unipile webhook)%'
  )
  AND wi."updatedAt" >= NOW() - INTERVAL '30 days';

UPDATE "_artifact" art
SET
  "deletedAt" = NOW(),
  "updatedAt" = NOW()
WHERE art."workflowItemId" IN (SELECT id FROM prune_unipile_wo)
  AND UPPER(TRIM(art.stage::text)) IN ('REPLIED', 'REPLY_DRAFT')
  AND art."deletedAt" IS NULL;

UPDATE "_workflow_item" wi
SET
  stage = 'MESSAGED',
  "dueDate" = (NOW() + INTERVAL '4 days'),
  "humanTaskOpen" = false,
  "updatedAt" = NOW()
WHERE wi.id IN (SELECT id FROM prune_unipile_wo)
  AND wi."deletedAt" IS NULL;

COMMIT;
