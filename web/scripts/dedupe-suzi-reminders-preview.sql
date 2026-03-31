SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

SELECT COUNT(*) AS rows_to_soft_delete
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        lower(trim(title)),
        category,
        COALESCE("nextDueAt", 'epoch'::timestamptz)
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "_reminder"
  WHERE "deletedAt" IS NULL
    AND "agentId" = 'suzi'
) s
WHERE rn > 1;

SELECT lower(trim(title)) AS title_key, category, "nextDueAt", COUNT(*) AS cnt
FROM "_reminder"
WHERE "deletedAt" IS NULL AND "agentId" = 'suzi'
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1
ORDER BY cnt DESC
LIMIT 25;
