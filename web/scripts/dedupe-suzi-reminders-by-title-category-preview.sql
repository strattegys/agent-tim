SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

SELECT COUNT(*) AS rows_to_soft_delete
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(title)), category
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "_reminder"
  WHERE "deletedAt" IS NULL
    AND "agentId" = 'suzi'
) s
WHERE rn > 1;
