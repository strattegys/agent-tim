-- Subtasks / actions on punch list items (checkboxes in Inspect; Suzi can toggle via punch_list tool).
CREATE TABLE IF NOT EXISTS "_punch_list_action" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "itemId" UUID NOT NULL REFERENCES "_punch_list"(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_punch_list_action_item ON "_punch_list_action" ("itemId");
