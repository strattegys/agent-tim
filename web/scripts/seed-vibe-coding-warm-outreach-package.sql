-- Seed: Vibe Coding with Tim Warm Outreach package (template vibe-coding-outreach)
-- Run against the Twenty / CRM Postgres database, same workspace schema as migrate-packages.sql
--
-- Preferred (loads web/.env.local — same CRM_DB_* as the Next app):
--   cd web && npm run db:exec -- scripts/seed-vibe-coding-warm-outreach-package.sql
--
-- Or: docker exec -i twenty-db-1 psql -U postgres -d default < web/scripts/seed-vibe-coding-warm-outreach-package.sql
-- Or: psql "postgresql://USER:PASS@HOST:5432/DATABASE" -f web/scripts/seed-vibe-coding-warm-outreach-package.sql

SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

INSERT INTO "_package" ("templateId", name, "customerId", "customerType", spec, stage, "createdBy", "createdAt", "updatedAt")
SELECT
  'vibe-coding-outreach',
  'Vibe Coding with Tim Warm Outreach',
  NULL,
  'person',
  '{
    "deliverables": [
      {
        "workflowType": "warm-outreach",
        "ownerAgent": "tim",
        "targetCount": 10,
        "label": "Warm Outreach"
      }
    ]
  }'::jsonb,
  'DRAFT',
  'penny',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM "_package" p
  WHERE p."deletedAt" IS NULL
    AND p.name = 'Vibe Coding with Tim Warm Outreach'
);

-- Show result (0 rows if duplicate name was skipped)
SELECT id, name, "templateId", stage, "createdAt"
FROM "_package"
WHERE "deletedAt" IS NULL
  AND name = 'Vibe Coding with Tim Warm Outreach'
ORDER BY "createdAt" DESC
LIMIT 1;
