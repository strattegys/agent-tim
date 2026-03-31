-- Legacy quick sample (humanTaskOpen only). For the full Tim **messaging** queue query
-- (matches the UI), use scripts/debug-tim-messaging-queue.sql
SELECT wi.id, wi.stage, wi."humanTaskOpen", w.name, w."ownerAgent"
FROM "_workflow_item" wi
INNER JOIN "_workflow" w ON w.id = wi."workflowId"
WHERE wi."deletedAt" IS NULL
  AND wi."humanTaskOpen" = true
  AND w."deletedAt" IS NULL
  AND LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = 'tim'
ORDER BY wi."createdAt" ASC
LIMIT 10;
