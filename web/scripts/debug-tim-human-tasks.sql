-- Same filters as GET /api/crm/human-tasks?ownerAgent=tim
SELECT wi.id, wi.stage, wi."humanTaskOpen", w.name, w."ownerAgent"
FROM "_workflow_item" wi
INNER JOIN "_workflow" w ON w.id = wi."workflowId"
LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
WHERE wi."deletedAt" IS NULL
  AND wi."humanTaskOpen" = true
  AND w."deletedAt" IS NULL
  AND LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = 'tim'
ORDER BY wi."createdAt" ASC
LIMIT 10;
