/**
 * Idempotent: inserts a DRAFT package "Agent Builder Launch" (templateId custom, no deliverables)
 * if none exists with that name (not soft-deleted). Workflows are added in the Package Kanban overlay.
 *
 * From web/:  npx tsx scripts/seed-agent-builder-package.ts
 * Or:         npm run seed:agent-builder
 */
import { createCrmPool } from "./crm-db-pool.mjs";
import path from "path";
import { fileURLToPath } from "url";
import { AGENT_BUILDER_LAUNCH_PACKAGE_NAME } from "../lib/package-presets";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "..");
const CRM_SCHEMA = process.env.CRM_DB_SEARCH_PATH || "workspace_9rc10n79wgdr0r3z6mzti24f6";

async function main() {
  const pool = await createCrmPool(WEB_ROOT);
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${CRM_SCHEMA}", public`);
    const existing = await client.query(
      `SELECT id FROM "_package" WHERE "templateId" = $1 AND name = $2 AND "deletedAt" IS NULL LIMIT 1`,
      ["custom", AGENT_BUILDER_LAUNCH_PACKAGE_NAME]
    );
    if (existing.rows.length > 0) {
      console.log(
        `Already exists: "${AGENT_BUILDER_LAUNCH_PACKAGE_NAME}" id=${existing.rows[0].id} — open Package Kanban.`
      );
      return;
    }
    const legacy = await client.query(
      `SELECT id, name FROM "_package" WHERE "templateId" = $1 AND name = $2 AND "deletedAt" IS NULL LIMIT 1`,
      ["custom", "Agent Builder"]
    );
    if (legacy.rows.length > 0) {
      console.log(
        `Found legacy row "${legacy.rows[0].name}" id=${legacy.rows[0].id} — rename to "${AGENT_BUILDER_LAUNCH_PACKAGE_NAME}" in the UI or DB if you want the new label. Skipping insert.`
      );
      return;
    }
    const spec = { deliverables: [] };
    const ins = await client.query(
      `INSERT INTO "_package" ("templateId", name, "customerId", "customerType", spec, stage, "createdBy", "createdAt", "updatedAt")
       VALUES ($1, $2, NULL, 'person', $3::jsonb, 'DRAFT', 'seed-agent-builder', NOW(), NOW())
       RETURNING id`,
      ["custom", AGENT_BUILDER_LAUNCH_PACKAGE_NAME, JSON.stringify(spec)]
    );
    console.log(`Created DRAFT package "${AGENT_BUILDER_LAUNCH_PACKAGE_NAME}" id=${ins.rows[0].id}`);
    console.log("Open Package Kanban → inspect the card → Add workflows in the overlay.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
