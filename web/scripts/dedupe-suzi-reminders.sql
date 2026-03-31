-- Preview then soft-delete duplicate Suzi reminders (same title + category + nextDueAt to the second).
-- Keeps the oldest row (min createdAt, then min id) per duplicate group.
SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

-- Preview: groups with more than one row
-- SELECT lower(trim(title)) AS title_key, category, "nextDueAt", COUNT(*) AS cnt
-- FROM "_reminder"
-- WHERE "deletedAt" IS NULL AND "agentId" = 'suzi'
-- GROUP BY 1, 2, 3
-- HAVING COUNT(*) > 1
-- ORDER BY cnt DESC;

WITH ranked AS (
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
)
UPDATE "_reminder" r
SET "deletedAt" = NOW(), "updatedAt" = NOW(), "isActive" = FALSE
FROM ranked x
WHERE r.id = x.id AND x.rn > 1;
