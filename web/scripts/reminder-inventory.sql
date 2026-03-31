SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

SELECT COUNT(*) FILTER (WHERE "deletedAt" IS NULL) AS active_total,
       COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "isActive") AS active_and_on,
       COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND NOT "isActive") AS active_but_off
FROM "_reminder"
WHERE "agentId" = 'suzi';

SELECT lower(trim(title)) AS title_key, category, COUNT(*) AS n
FROM "_reminder"
WHERE "deletedAt" IS NULL AND "agentId" = 'suzi'
GROUP BY 1, 2
ORDER BY n DESC
LIMIT 40;
