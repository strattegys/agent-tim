-- Rows that power "Awaiting contact" on Friday (human-tasks uses the same item filter + workflow joins)
SELECT
  wi.id AS workflow_item_id,
  wi.stage AS item_stage_raw,
  UPPER(TRIM(wi.stage::text)) AS item_stage_norm,
  wi."sourceType" AS source_type,
  wi."sourceId" AS source_id,
  wi."humanTaskOpen" AS human_task_open,
  wi."deletedAt" IS NOT NULL AS item_soft_deleted,
  wi."createdAt" AS item_created_at,
  w.id AS workflow_id,
  w.name AS workflow_name,
  w.stage AS workflow_row_stage,
  w."ownerAgent" AS owner_agent_raw,
  LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) AS owner_agent_norm,
  w."deletedAt" IS NOT NULL AS workflow_soft_deleted,
  w.spec AS workflow_spec,
  w."boardId" AS board_id,
  w."packageId" AS package_id,
  p.name AS package_name,
  p.stage AS package_stage,
  p."templateId" AS package_template_id,
  p.spec AS package_spec,
  b.stages AS board_stages,
  per."nameFirstName" AS person_first,
  per."nameLastName" AS person_last,
  per."jobTitle" AS person_job_title
FROM "_workflow_item" wi
INNER JOIN "_workflow" w ON w.id = wi."workflowId"
LEFT JOIN "_package" p ON p.id = w."packageId" AND p."deletedAt" IS NULL
LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
LEFT JOIN person per ON per.id = wi."sourceId" AND wi."sourceType" = 'person' AND per."deletedAt" IS NULL
WHERE wi."deletedAt" IS NULL
  AND UPPER(TRIM(wi.stage::text)) = 'AWAITING_CONTACT'
ORDER BY wi."createdAt" DESC
LIMIT 25;
