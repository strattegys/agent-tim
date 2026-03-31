-- Migration: Vector memory table (pgvector RAG) + rename reminder "fact" → "note"
-- Run (repo root): cat web/scripts/migrate-vector-memory.sql | docker compose --env-file web/.env.local -f docker-compose.yml exec -T crm-db psql -U postgres -d default

-- Enable pgvector extension (requires superuser)
CREATE EXTENSION IF NOT EXISTS vector;

-- Empty / first-run CRM volumes have no Twenty workspace yet; check-crm-db and the app expect this schema.
CREATE SCHEMA IF NOT EXISTS "workspace_9rc10n79wgdr0r3z6mzti24f6";

-- Extension types (vector) live in public — keep public on the path for CREATE TABLE.
SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6", public;

-- ============================================================
-- 1. Vector memory table
-- ============================================================
CREATE TABLE IF NOT EXISTS "_memory" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agentId" TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('preference','person','project','decision','fact','general')),
  embedding vector(768) NOT NULL,
  source TEXT NOT NULL DEFAULT 'tool'
    CHECK (source IN ('tool','consolidation','migration')),
  "sessionDate" DATE,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deletedAt" TIMESTAMPTZ
);

-- HNSW index for fast cosine similarity search (only active, non-deleted rows)
CREATE INDEX IF NOT EXISTS idx_memory_embedding_cosine
  ON "_memory" USING hnsw (embedding vector_cosine_ops)
  WHERE "deletedAt" IS NULL AND "isActive" = TRUE;

-- Filter indexes
CREATE INDEX IF NOT EXISTS idx_memory_agent
  ON "_memory" ("agentId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_memory_agent_category
  ON "_memory" ("agentId", category)
  WHERE "deletedAt" IS NULL;

-- ============================================================
-- 2. Rename reminder category "fact" → "note" (Twenty schema only)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'workspace_9rc10n79wgdr0r3z6mzti24f6'
      AND table_name = '_reminder'
  ) THEN
    UPDATE "_reminder" SET category = 'note' WHERE category = 'fact';
    ALTER TABLE "_reminder" DROP CONSTRAINT IF EXISTS "_reminder_category_check";
    ALTER TABLE "_reminder" ADD CONSTRAINT "_reminder_category_check"
      CHECK (category IN ('birthday','holiday','recurring','one-time','note'));
  END IF;
END $$;
