/**
 * Recompute `_workflow_item.humanTaskOpen` from board `requiresHuman` + workflow templates
 * (same logic as syncHumanTaskOpenForItem). Use when Tim’s queue shows stale rows after
 * board edits or code changes.
 *
 * From web/:
 *   npm run backfill:tim-human-task-open -- --dry-run
 *   npm run backfill:tim-human-task-open
 *   npm run backfill:tim-human-task-open -- --messaging-only
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(WEB_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("Missing web/.env.local");
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    const k = m[1];
    if (process.env[k] === undefined || process.env[k] === "") process.env[k] = v;
  }
}

const MESSAGING_STAGES = [
  "INITIATED",
  "AWAITING_CONTACT",
  "MESSAGE_DRAFT",
  "MESSAGED",
  "REPLY_DRAFT",
  "REPLY_SENT",
  "LINKEDIN_INBOUND",
  "CONNECTION_ACCEPTED",
] as const;

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    dryRun: argv.includes("--dry-run"),
    messagingOnly: argv.includes("--messaging-only"),
  };
}

async function main() {
  const { dryRun, messagingOnly } = parseArgs();
  loadEnvLocal();

  const { query } = await import("../lib/db");
  const { syncHumanTaskOpenForItem } = await import("../lib/workflow-item-human-task");

  const stageClause = messagingOnly
    ? `AND UPPER(TRIM(wi.stage::text)) IN (${MESSAGING_STAGES.map((s) => `'${s}'`).join(", ")})`
    : "";

  const rows = await query<{ id: string }>(
    `SELECT wi.id
     FROM "_workflow_item" wi
     INNER JOIN "_workflow" w ON w.id = wi."workflowId"
     WHERE wi."deletedAt" IS NULL
       AND w."deletedAt" IS NULL
       AND LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = 'tim'
       ${stageClause}
     ORDER BY wi."createdAt" ASC`,
    []
  );

  console.log(
    `Tim workflow items to sync: ${rows.length}${messagingOnly ? " (messaging stages only)" : " (all stages)"}`
  );

  if (dryRun) {
    console.log("Dry run — no updates. Run without --dry-run to apply syncHumanTaskOpenForItem to each row.");
    return;
  }

  let n = 0;
  for (const r of rows) {
    await syncHumanTaskOpenForItem(r.id);
    n++;
    if (n % 25 === 0) console.log(`  synced ${n}/${rows.length}…`);
  }
  console.log(`Done. Synced ${n} workflow item(s). Reload Tim’s queue in the browser.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
