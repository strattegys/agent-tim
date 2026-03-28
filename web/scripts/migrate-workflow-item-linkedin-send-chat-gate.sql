-- Tim LinkedIn send gate: Govind must reply "Send It Now" in Tim chat after Tim posts the exact draft, then Submit.
-- Run against the same CRM schema as Command Central workflow tables.

ALTER TABLE "_workflow_item" ADD COLUMN IF NOT EXISTS "linkedinSendChatPlainHash" text NULL;
ALTER TABLE "_workflow_item" ADD COLUMN IF NOT EXISTS "linkedinSendChatNotifiedAt" timestamptz NULL;
ALTER TABLE "_workflow_item" ADD COLUMN IF NOT EXISTS "linkedinSendChatApprovedAt" timestamptz NULL;
