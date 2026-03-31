-- Rows returned by GET /api/crm/human-tasks?ownerAgent=tim&messagingOnly=1
-- (same human/package/stage filters as route.ts). Run from web/: npm run db:exec -- scripts/debug-tim-messaging-queue.sql
SELECT wi.id,
       wi.stage,
       wi."humanTaskOpen",
       w.name AS workflow_name,
       w."packageId",
       UPPER(TRIM(COALESCE(p.stage::text, ''))) AS package_stage,
       LEFT(COALESCE(w.spec::text, ''), 160) AS workflow_spec_snip,
       COALESCE(wi."updatedAt", wi."createdAt") AS sort_ts
FROM "_workflow_item" wi
INNER JOIN "_workflow" w ON w.id = wi."workflowId"
LEFT JOIN "_package" p ON p.id = w."packageId" AND p."deletedAt" IS NULL
WHERE wi."deletedAt" IS NULL
  AND w."deletedAt" IS NULL
  AND LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = 'tim'
  AND (
    wi."humanTaskOpen" = true
    OR (
      UPPER(TRIM(wi.stage::text)) = 'MESSAGED'
      AND COALESCE(w.spec::text, '') LIKE '%"workflowType"%'
      AND COALESCE(w.spec::text, '') LIKE '%warm-outreach%'
    )
  )
  AND (w."packageId" IS NULL OR (p.id IS NOT NULL AND UPPER(TRIM(COALESCE(p.stage::text, ''))) = 'ACTIVE'))
  AND UPPER(TRIM(wi.stage::text)) IN (
    'INITIATED',
    'AWAITING_CONTACT',
    'MESSAGE_DRAFT',
    'MESSAGED',
    'REPLY_DRAFT',
    'REPLY_SENT',
    'LINKEDIN_INBOUND',
    'CONNECTION_ACCEPTED'
  )
ORDER BY COALESCE(wi."updatedAt", wi."createdAt") DESC, wi."createdAt" DESC;
