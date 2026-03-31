-- Soft-delete duplicate Suzi reminders that share the same title + category.
-- Keeps the oldest row (min createdAt, then min id). Use when the queue has
-- accidental duplicates (e.g. spam/import) rather than legitimately distinct
-- rows with identical labels (rare).
SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(title)), category
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
