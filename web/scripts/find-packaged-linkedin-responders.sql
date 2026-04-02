-- Read-only: packaged Tim LinkedIn-style workflows where the thread has moved past first send / into reply.
-- Run from web/: npm run db:exec -- scripts/find-packaged-linkedin-responders.sql
-- Adjust LIMIT or add AND wi."updatedAt" > now() - interval '30 days' as needed.

SELECT
  wi.id AS "workflowItemId",
  UPPER(TRIM(wi.stage::text)) AS stage,
  wi."updatedAt",
  wi."sourceId" AS "personId",
  TRIM(COALESCE(p."nameFirstName", '')) || ' ' || TRIM(COALESCE(p."nameLastName", '')) AS "personName",
  pkg.id AS "packageId",
  pkg.name AS "packageName",
  UPPER(TRIM(COALESCE(pkg.stage::text, ''))) AS "packageStage",
  w.id AS "workflowId",
  w.name AS "workflowName"
FROM "_workflow_item" wi
INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
LEFT JOIN "_package" pkg ON pkg.id = w."packageId" AND pkg."deletedAt" IS NULL
LEFT JOIN person p ON p.id = wi."sourceId"
  AND LOWER(TRIM(wi."sourceType"::text)) = 'person'
  AND p."deletedAt" IS NULL
WHERE wi."deletedAt" IS NULL
  AND w."packageId" IS NOT NULL
  AND LOWER(TRIM(w."ownerAgent"::text)) = 'tim'
  AND UPPER(TRIM(wi.stage::text)) IN (
    'REPLY_DRAFT',
    'LINKEDIN_INBOUND',
    'REPLIED',
    'REPLY_SENT',
    'MESSAGED',
    'ACCEPTED',
    'CONNECTION_ACCEPTED',
    'INITIATED'
  )
  AND (
    COALESCE(w.spec::text, '') ILIKE '%linkedin-outreach%'
    OR COALESCE(w.spec::text, '') ILIKE '%linkedin%outreach%'
  )
ORDER BY wi."updatedAt" DESC NULLS LAST
LIMIT 300;
