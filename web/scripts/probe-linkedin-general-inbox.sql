-- Diagnostic: Tim LinkedIn general inbox vs receipt migration (run from web/: npm run db:exec -- scripts/probe-linkedin-general-inbox.sql)

SELECT 'receipt_table_exists' AS section,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = '_linkedin_inbound_receipt'
  )::text AS detail;

SELECT 'gi_open_count' AS section, COUNT(*)::text AS detail
FROM "_workflow_item" wi
JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
WHERE wi."deletedAt" IS NULL
  AND UPPER(TRIM(wi.stage::text)) = 'LINKEDIN_INBOUND'
  AND (w.spec::text LIKE '%linkedin-general-inbox%');

SELECT 'gi_recent' AS section,
  wi."updatedAt"::text || ' | open=' || wi."humanTaskOpen"::text || ' | ' || wi.id::text || ' | ' ||
  COALESCE(p."nameFirstName", '') || ' ' || COALESCE(p."nameLastName", '') AS detail
FROM "_workflow_item" wi
JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
JOIN person p ON p.id = wi."sourceId"::uuid
WHERE wi."deletedAt" IS NULL
  AND UPPER(TRIM(wi.stage::text)) = 'LINKEDIN_INBOUND'
  AND (w.spec::text LIKE '%linkedin-general-inbox%')
ORDER BY wi."updatedAt" DESC NULLS LAST
LIMIT 25;

SELECT 'artifact_inbound_7d' AS section, COUNT(*)::text AS detail
FROM "_artifact" a
WHERE a.name = 'LinkedIn: inbound message'
  AND a."createdAt" > NOW() - INTERVAL '7 days';
