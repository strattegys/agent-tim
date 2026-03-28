-- Embed punch-list checkbox actions on each row (JSONB) instead of a separate table.
-- Ephemeral subtasks stay on the card (no separate actions table).
-- Run from COMMAND-CENTRAL web folder: npm run db:punch-list-actions
-- Or pipe this file into crm-db psql (see deploy-web.yml).

SET search_path TO "workspace_9rc10n79wgdr0r3z6mzti24f6", public;

ALTER TABLE "_punch_list" ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = ANY (current_schemas(true))
      AND table_name = '_punch_list_action'
  ) THEN
    UPDATE "_punch_list" p
    SET actions = COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'content', a.content,
          'done', a.done,
          'sortOrder', a."sortOrder",
          'createdAt', a."createdAt",
          'updatedAt', a."updatedAt"
        ) ORDER BY a."sortOrder", a."createdAt"
      )
      FROM "_punch_list_action" a
      WHERE a."itemId" = p.id
    ), '[]'::jsonb);
    DROP TABLE "_punch_list_action";
  END IF;
END $$;
