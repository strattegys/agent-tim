-- Migration: Marni Knowledge Studio (_kb_topic, _kb_research_run, _agent_knowledge, pgvector 768, topic_kind)
-- Idempotent. GitHub Actions deploy pipes only this file into crm-db — topic_kind must live here
-- (not only in migrate-kb-topic-kind.sql) or production INSERTs fail: column topic_kind does not exist.
-- Run (from COMMAND-CENTRAL): cat web/scripts/migrate-marni-kb.sql | docker compose --env-file web/.env.local -f docker-compose.yml exec -T crm-db psql -U postgres -d default

CREATE EXTENSION IF NOT EXISTS vector;
SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6", public;
CREATE TABLE IF NOT EXISTS "_kb_topic" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agentId" TEXT NOT NULL DEFAULT 'marni',
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  queries JSONB NOT NULL DEFAULT '[]'::jsonb,
  "postUrls" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "sourceMode" TEXT NOT NULL DEFAULT 'web_only'
    CHECK ("sourceMode" IN ('web_only', 'linkedin_only', 'both')),
  "cadenceMinutes" INTEGER,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  "lastRunAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_kb_topic_agent_slug UNIQUE ("agentId", slug)
);
CREATE INDEX IF NOT EXISTS idx_kb_topic_agent ON "_kb_topic" ("agentId") WHERE enabled = TRUE;
CREATE TABLE IF NOT EXISTS "_kb_research_run" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "topicId" UUID NOT NULL REFERENCES "_kb_topic"(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'error')),
  "sourcesFound" INTEGER NOT NULL DEFAULT 0,
  "chunksIngested" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completedAt" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_kb_run_topic_started ON "_kb_research_run" ("topicId", "startedAt" DESC);
CREATE TABLE IF NOT EXISTS "_agent_knowledge" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agentId" TEXT NOT NULL,
  "topicId" UUID REFERENCES "_kb_topic"(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  embedding vector(768) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deletedAt" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_embedding_hnsw ON "_agent_knowledge" USING hnsw (embedding vector_cosine_ops) WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_agent ON "_agent_knowledge" ("agentId") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_topic ON "_agent_knowledge" ("topicId") WHERE "deletedAt" IS NULL AND "topicId" IS NOT NULL;

-- Brave research vs Tim CRM mirror corpus (app INSERT/UPDATE require this column).
ALTER TABLE "_kb_topic"
  ADD COLUMN IF NOT EXISTS topic_kind TEXT NOT NULL DEFAULT 'research'
    CHECK (topic_kind IN ('research', 'crm_mirror'));
CREATE INDEX IF NOT EXISTS idx_kb_topic_agent_kind ON "_kb_topic" ("agentId", topic_kind);
