SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

SELECT COUNT(*) AS total_active_rows
FROM "_reminder"
WHERE "deletedAt" IS NULL AND "agentId" = 'suzi';

SELECT COUNT(*) AS due_today_pt
FROM "_reminder"
WHERE "deletedAt" IS NULL
  AND "agentId" = 'suzi'
  AND "nextDueAt" IS NOT NULL
  AND to_char("nextDueAt" AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD')
    = to_char(NOW() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD');

SELECT COUNT(*) AS inactive_not_deleted
FROM "_reminder"
WHERE "deletedAt" IS NULL AND "agentId" = 'suzi' AND "isActive" = FALSE;
