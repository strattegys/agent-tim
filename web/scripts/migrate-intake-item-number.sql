-- Persistent intake item numbers (stable IDs — same pattern as _punch_list.itemNumber).
-- Run after migrate-intake.sql. Idempotent.
--
-- From COMMAND-CENTRAL:
--   docker compose --env-file web/.env.local -f docker-compose.yml exec -T crm-db psql -U postgres -d default -v ON_ERROR_STOP=1 < web/scripts/migrate-intake-item-number.sql

SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

CREATE SEQUENCE IF NOT EXISTS intake_item_number_seq START WITH 2001;

ALTER TABLE "_intake" ADD COLUMN IF NOT EXISTS "itemNumber" INTEGER;

UPDATE "_intake"
SET "itemNumber" = sub.new_num
FROM (
  SELECT id, nextval('intake_item_number_seq') AS new_num
  FROM "_intake"
  WHERE "itemNumber" IS NULL
  ORDER BY "createdAt" ASC
) sub
WHERE "_intake".id = sub.id;

SELECT setval(
  'intake_item_number_seq',
  GREATEST(2000, COALESCE((SELECT MAX("itemNumber") FROM "_intake"), 2000))
);

ALTER TABLE "_intake" ALTER COLUMN "itemNumber" SET DEFAULT nextval('intake_item_number_seq');

ALTER TABLE "_intake" ALTER COLUMN "itemNumber" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_item_number_unique ON "_intake" ("itemNumber");
