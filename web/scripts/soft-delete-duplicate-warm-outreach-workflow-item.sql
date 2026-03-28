-- Soft-delete the *older* warm-outreach workflow item for a person when two workflows
-- exist for the same contact (e.g. bad first run + good restart). Adjust the name filters
-- and paste the chosen `wi.id` into the UPDATE.
--
-- Run (from COMMAND-CENTRAL/web, same search_path as the app):
--   npm run db:exec -- scripts/soft-delete-duplicate-warm-outreach-workflow-item.sql
--
-- 1) Inspect rows — pick the **first** (earliest createdAt) item if that is the bad path.

SELECT
  wi.id AS workflow_item_id,
  wi."createdAt",
  wi.stage,
  wi."workflowId",
  w.name AS workflow_name,
  p.id AS person_id,
  p."nameFirstName",
  p."nameLastName"
FROM "_workflow_item" wi
INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
INNER JOIN person p ON p.id = wi."sourceId" AND p."deletedAt" IS NULL
WHERE wi."deletedAt" IS NULL
  AND wi."sourceType" = 'person'
  AND TRIM(COALESCE(p."nameFirstName", '')) ILIKE '%chris%'
  AND TRIM(COALESCE(p."nameLastName", '')) ILIKE '%mcgrath%'
ORDER BY wi."createdAt" ASC;

-- 2) Uncomment and set `workflow_item_id` to the row you want removed (usually the earliest one).

-- BEGIN;
-- UPDATE "_workflow_item"
-- SET
--   "deletedAt" = NOW(),
--   "updatedAt" = NOW()
-- WHERE id = '00000000-0000-0000-0000-000000000000'::uuid
--   AND "deletedAt" IS NULL;
-- COMMIT;
