-- Preview only: rows touched by Unipile replay (general inbox + mistaken warm-outreach "replied").
-- Run against production CRM (same search_path as the app):
--   cd COMMAND-CENTRAL/web
--   npm run db:exec -- scripts/prune-unipile-replay-prod-preview.sql
--
-- Verify counts match what you see in Tim’s queue, then run prune-unipile-replay-prod-apply.sql
-- (or narrow apply with explicit wi.id IN (...) copied from these results).

-- 1) LinkedIn general inbox — replay appends artifacts with this header
SELECT
  'general_inbox' AS kind,
  wi.id AS workflow_item_id,
  wi."createdAt",
  wi."updatedAt",
  wi.stage,
  w.name AS workflow_name,
  p."nameFirstName",
  p."nameLastName",
  LEFT(a.content, 120) AS content_preview
FROM "_workflow_item" wi
INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
LEFT JOIN person p ON p.id = wi."sourceId" AND wi."sourceType" = 'person' AND p."deletedAt" IS NULL
INNER JOIN "_artifact" a ON a."workflowItemId" = wi.id AND a."deletedAt" IS NULL
WHERE wi."deletedAt" IS NULL
  AND UPPER(TRIM(wi.stage::text)) = 'LINKEDIN_INBOUND'
  AND (
    COALESCE(w.spec::text, '') LIKE '%linkedin-general-inbox%'
    OR COALESCE(w.name, '') ILIKE '%general inbox%'
  )
  AND a.content LIKE '%## LinkedIn — inbound message (general inbox)%'
  AND wi."updatedAt" >= NOW() - INTERVAL '30 days'
ORDER BY wi."updatedAt" DESC;

-- 2) Packaged warm-outreach — replay called resolve with inbound notes containing this header
SELECT
  'warm_outreach_undo' AS kind,
  wi.id AS workflow_item_id,
  wi.stage,
  wi."createdAt",
  wi."updatedAt",
  w.name AS workflow_name,
  p."nameFirstName",
  p."nameLastName"
FROM "_workflow_item" wi
INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
LEFT JOIN person p ON p.id = wi."sourceId" AND wi."sourceType" = 'person' AND p."deletedAt" IS NULL
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
  AND wi."updatedAt" >= NOW() - INTERVAL '30 days'
ORDER BY wi."updatedAt" DESC;
