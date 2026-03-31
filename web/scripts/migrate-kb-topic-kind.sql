-- Knowledge Studio: topic_kind column (research vs crm_mirror).
-- Merged into migrate-marni-kb.sql for deploy; this file stays as an idempotent one-liner
-- if you applied an older migrate-marni-kb.sql before topic_kind existed.

SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6", public;

ALTER TABLE "_kb_topic"
  ADD COLUMN IF NOT EXISTS topic_kind TEXT NOT NULL DEFAULT 'research'
    CHECK (topic_kind IN ('research', 'crm_mirror'));

CREATE INDEX IF NOT EXISTS idx_kb_topic_agent_kind ON "_kb_topic" ("agentId", topic_kind);
