-- One-off: repoint legacy warm-outreach discovery rows from placeholder CRM persons
-- (Next / Contact + "Warm outreach — awaiting contact details" job title) to `warm_discovery`
-- slots, then soft-delete those persons when nothing else links to them as `sourceType = person`.
--
-- Run on the CRM database after deploying code that understands `sourceType = warm_discovery`.
-- Review counts in a transaction before COMMIT.

BEGIN;

-- 1) Items still tied to the old placeholder person at AWAITING_CONTACT
UPDATE "_workflow_item" wi
SET
  "sourceType" = 'warm_discovery',
  "sourceId" = gen_random_uuid(),
  "updatedAt" = NOW()
FROM person p
WHERE wi."deletedAt" IS NULL
  AND wi."sourceType" = 'person'
  AND wi."sourceId" = p.id
  AND p."deletedAt" IS NULL
  AND TRIM(COALESCE(p."nameFirstName", '')) = 'Next'
  AND TRIM(COALESCE(p."nameLastName", '')) = 'Contact'
  AND TRIM(COALESCE(p."jobTitle", '')) = 'Warm outreach — awaiting contact details'
  AND UPPER(TRIM(wi.stage::text)) = 'AWAITING_CONTACT';

-- 2) Any other workflow items still pointing at those placeholder persons (stale stages, etc.)
UPDATE "_workflow_item" wi
SET
  "sourceType" = 'warm_discovery',
  "sourceId" = gen_random_uuid(),
  "updatedAt" = NOW()
FROM person p
WHERE wi."deletedAt" IS NULL
  AND wi."sourceType" = 'person'
  AND wi."sourceId" = p.id
  AND p."deletedAt" IS NULL
  AND TRIM(COALESCE(p."nameFirstName", '')) = 'Next'
  AND TRIM(COALESCE(p."nameLastName", '')) = 'Contact'
  AND TRIM(COALESCE(p."jobTitle", '')) = 'Warm outreach — awaiting contact details';

-- 3) Soft-delete placeholder persons no longer referenced by any active person workflow item
UPDATE person p
SET
  "deletedAt" = NOW(),
  "updatedAt" = NOW()
WHERE p."deletedAt" IS NULL
  AND TRIM(COALESCE(p."nameFirstName", '')) = 'Next'
  AND TRIM(COALESCE(p."nameLastName", '')) = 'Contact'
  AND TRIM(COALESCE(p."jobTitle", '')) = 'Warm outreach — awaiting contact details'
  AND NOT EXISTS (
    SELECT 1
    FROM "_workflow_item" wi
    WHERE wi."deletedAt" IS NULL
      AND wi."sourceType" = 'person'
      AND wi."sourceId" = p.id
  );

COMMIT;
