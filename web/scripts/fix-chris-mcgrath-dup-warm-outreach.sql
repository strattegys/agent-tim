-- Chris McGrath: one-time dedupe when two workflow items existed for duplicate person rows.
-- If duplicates return on **production**, run **inspect-chris-mcgrath-workflows.sql** first, then either
-- adjust UUIDs below or use **soft-delete-duplicate-warm-outreach-workflow-item.sql** (comment lines must not contain `;` before newline for db:exec).
--
-- Run from COMMAND-CENTRAL/web:
--   npm run db:exec -- scripts/fix-chris-mcgrath-dup-warm-outreach.sql

BEGIN;

-- Keep the newer workflow item and point it at the oldest CRM person (same LinkedIn URL).
UPDATE "_workflow_item"
SET
  "sourceId" = '61f278db-f9f0-4dd9-8fc8-d8aabea0dc1f'::uuid,
  "updatedAt" = NOW()
WHERE id = '90d23ca3-a57f-4577-bb3a-cdadd4e0a116'::uuid
  AND "deletedAt" IS NULL;

-- Remove the duplicate line (earlier Mar 27 run).
UPDATE "_workflow_item"
SET
  "deletedAt" = NOW(),
  "updatedAt" = NOW(),
  "humanTaskOpen" = false
WHERE id = '95dd8a32-d634-4d44-950c-84aa61d1d2f6'::uuid
  AND "deletedAt" IS NULL;

-- Orphan duplicate person rows (same name + LinkedIn as canonical).
UPDATE person
SET
  "deletedAt" = NOW(),
  "updatedAt" = NOW()
WHERE id IN (
  '62861ffc-79a2-4ac2-b855-e28741307465'::uuid,
  'ef184d9e-8ece-4c19-a728-47b74194f36a'::uuid
)
  AND "deletedAt" IS NULL;

COMMIT;
