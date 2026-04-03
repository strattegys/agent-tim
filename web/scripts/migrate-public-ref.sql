-- Human-readable public refs: two-letter prefix + stable number (e.g. IN2001, RM42, NT5001, PL1040).
-- Uniqueness: full string is unique per table — prefixes avoid collisions across entity types.
-- Prerequisites: migrate-intake-item-number.sql, migrate-punch-list-item-number.sql, migrate-notes.sql, migrate-reminders.sql
--
-- Run (from repo root):
--   docker compose --env-file web/.env.local -f docker-compose.yml exec -T crm-db psql -U postgres -d default -v ON_ERROR_STOP=1 < web/scripts/migrate-public-ref.sql

SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6";

-- ─── Intake: derived from existing itemNumber ─────────────────────────────────
ALTER TABLE "_intake" ADD COLUMN IF NOT EXISTS "publicRef" TEXT
  GENERATED ALWAYS AS ('IN' || "itemNumber"::text) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_public_ref ON "_intake" ("publicRef");

-- ─── Punch list ─────────────────────────────────────────────────────────────
ALTER TABLE "_punch_list" ADD COLUMN IF NOT EXISTS "publicRef" TEXT
  GENERATED ALWAYS AS ('PL' || "itemNumber"::text) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_punch_list_public_ref ON "_punch_list" ("publicRef");

-- ─── Notes ──────────────────────────────────────────────────────────────────
ALTER TABLE "_note" ADD COLUMN IF NOT EXISTS "publicRef" TEXT
  GENERATED ALWAYS AS ('NT' || "noteNumber"::text) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_note_public_ref ON "_note" ("publicRef");

-- ─── Reminders: new sequence + number column (no prior numeric id) ─────────
CREATE SEQUENCE IF NOT EXISTS reminder_number_seq START WITH 1;

ALTER TABLE "_reminder" ADD COLUMN IF NOT EXISTS "reminderNumber" INTEGER;

UPDATE "_reminder" r
SET "reminderNumber" = sub.n
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id) AS n
  FROM "_reminder"
  WHERE "reminderNumber" IS NULL
) sub
WHERE r.id = sub.id;

SELECT setval(
  'reminder_number_seq',
  GREATEST(0, COALESCE((SELECT MAX("reminderNumber") FROM "_reminder"), 0))
);

ALTER TABLE "_reminder" ALTER COLUMN "reminderNumber" SET DEFAULT nextval('reminder_number_seq');
ALTER TABLE "_reminder" ALTER COLUMN "reminderNumber" SET NOT NULL;

ALTER SEQUENCE reminder_number_seq OWNED BY "_reminder"."reminderNumber";

ALTER TABLE "_reminder" ADD COLUMN IF NOT EXISTS "publicRef" TEXT
  GENERATED ALWAYS AS ('RM' || "reminderNumber"::text) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_number ON "_reminder" ("reminderNumber");
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_public_ref ON "_reminder" ("publicRef");
