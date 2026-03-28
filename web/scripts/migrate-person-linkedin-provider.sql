-- Optional: store Unipile / LinkedIn API member id (e.g. ACoAABc…) separately from the public profile URL.
-- Run on the same CRM Postgres as Command Central (DATABASE_URL).
-- Twenty sync: if this column is stripped on sync, prefer storing member id only in Command Central–owned DBs.

ALTER TABLE person
  ADD COLUMN IF NOT EXISTS "linkedinProviderId" text NULL;

COMMENT ON COLUMN person."linkedinProviderId" IS 'LinkedIn member id for Unipile API (ACoA…). Public vanity URL stays in linkedinLinkPrimaryLinkUrl.';
