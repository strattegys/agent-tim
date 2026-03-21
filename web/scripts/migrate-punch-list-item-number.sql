-- Add a persistent, auto-incrementing item number to punch list items.
-- This replaces the previous index-based numbering which shifted with filters.

-- 1. Create a sequence starting at 1001
CREATE SEQUENCE IF NOT EXISTS punch_list_item_number_seq START WITH 1001;

-- 2. Add the column with a default from the sequence
ALTER TABLE "_punch_list"
  ADD COLUMN IF NOT EXISTS "itemNumber" INTEGER UNIQUE DEFAULT nextval('punch_list_item_number_seq');

-- 3. Backfill existing rows (ordered by creation date) if they have NULL itemNumber
UPDATE "_punch_list"
SET "itemNumber" = sub.new_num
FROM (
  SELECT id, nextval('punch_list_item_number_seq') AS new_num
  FROM "_punch_list"
  WHERE "itemNumber" IS NULL
  ORDER BY "createdAt" ASC
) sub
WHERE "_punch_list".id = sub.id;

-- 4. Make it NOT NULL now that all rows have a value
ALTER TABLE "_punch_list" ALTER COLUMN "itemNumber" SET NOT NULL;
