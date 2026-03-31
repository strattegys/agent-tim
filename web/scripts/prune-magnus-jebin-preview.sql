-- Preview: Magnus / Jebin mistaken replay rows (name + general inbox, or warm-outreach + Unipile webhook header).
--   cd COMMAND-CENTRAL/web && npm run db:exec -- scripts/prune-magnus-jebin-preview.sql
-- If this returns 0 rows but Tim still shows queue noise, confirm `CRM_DB_*` targets the same DB as the UI.

-- 1) General inbox + person name (any artifact — catches variant headers)
SELECT
  'general_inbox_by_name' AS kind,
  wi.id AS workflow_item_id,
  wi."updatedAt",
  wi.stage,
  w.name AS workflow_name,
  p."nameFirstName",
  p."nameLastName",
  (SELECT COUNT(*)::int FROM "_artifact" ax WHERE ax."workflowItemId" = wi.id AND ax."deletedAt" IS NULL) AS artifact_count,
  (SELECT LEFT(MIN(ax.content), 140) FROM "_artifact" ax WHERE ax."workflowItemId" = wi.id AND ax."deletedAt" IS NULL) AS first_artifact_preview
FROM "_workflow_item" wi
INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
LEFT JOIN person p ON p.id = wi."sourceId" AND wi."sourceType" = 'person' AND p."deletedAt" IS NULL
WHERE wi."deletedAt" IS NULL
  AND UPPER(TRIM(wi.stage::text)) = 'LINKEDIN_INBOUND'
  AND (
    COALESCE(w.spec::text, '') LIKE '%linkedin-general-inbox%'
    OR COALESCE(w.name, '') ILIKE '%general inbox%'
  )
  AND (
    p."nameFirstName" ILIKE '%magnus%'
    OR p."nameLastName" ILIKE '%magnus%'
    OR p."nameFirstName" ILIKE '%jebin%'
    OR p."nameLastName" ILIKE '%jebin%'
  )
ORDER BY wi."updatedAt" DESC;

-- 2) Warm-outreach REPLIED/REPLY_DRAFT + person name + Unipile webhook artifact
SELECT
  'warm_outreach_by_name' AS kind,
  wi.id AS workflow_item_id,
  wi."updatedAt",
  wi.stage,
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
  AND (
    p."nameFirstName" ILIKE '%magnus%'
    OR p."nameLastName" ILIKE '%magnus%'
    OR p."nameFirstName" ILIKE '%jebin%'
    OR p."nameLastName" ILIKE '%jebin%'
  )
ORDER BY wi."updatedAt" DESC;
