-- Read-only: list workflow items for Chris McGrath (adjust ILIKE if needed).
-- Use to pick the **earliest** active row to soft-delete when two lines exist for the same contact.
--
--   npm run db:exec -- scripts/inspect-chris-mcgrath-workflows.sql

SELECT wi.id AS workflow_item_id,
       wi."createdAt",
       wi.stage,
       wi."deletedAt",
       wi."workflowId",
       wi."sourceId",
       w.name AS workflow_name,
       w."packageId",
       p."nameFirstName",
       p."nameLastName"
FROM "_workflow_item" wi
INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
INNER JOIN person p ON p.id = wi."sourceId" AND wi."sourceType" = 'person' AND p."deletedAt" IS NULL
WHERE TRIM(COALESCE(p."nameFirstName", '')) ILIKE '%chris%'
  AND TRIM(COALESCE(p."nameLastName", '')) ILIKE '%mcgrath%'
ORDER BY wi."createdAt" ASC;
