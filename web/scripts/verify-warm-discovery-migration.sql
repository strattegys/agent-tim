-- Post-migration sanity checks (read-only)
SELECT COUNT(*)::int AS live_placeholder_persons
FROM person p
WHERE p."deletedAt" IS NULL
  AND TRIM(COALESCE(p."nameFirstName", '')) = 'Next'
  AND TRIM(COALESCE(p."nameLastName", '')) = 'Contact'
  AND TRIM(COALESCE(p."jobTitle", '')) = 'Warm outreach — awaiting contact details';

SELECT COUNT(*)::int AS warm_discovery_items
FROM "_workflow_item" wi
WHERE wi."deletedAt" IS NULL
  AND wi."sourceType" = 'warm_discovery';

SELECT COUNT(*)::int AS items_still_on_placeholder_person
FROM "_workflow_item" wi
INNER JOIN person p ON p.id = wi."sourceId" AND wi."sourceType" = 'person' AND p."deletedAt" IS NULL
WHERE wi."deletedAt" IS NULL
  AND TRIM(COALESCE(p."nameFirstName", '')) = 'Next'
  AND TRIM(COALESCE(p."nameLastName", '')) = 'Contact';
