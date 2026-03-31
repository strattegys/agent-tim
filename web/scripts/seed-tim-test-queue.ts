/**
 * Seed Tim’s work queue for local / Docker dev (Postgres with CRM schema).
 *
 * Usage (from web/):
 *   npx tsx scripts/seed-tim-test-queue.ts
 *   npx tsx scripts/seed-tim-test-queue.ts --force   # soft-delete prior seed rows, then re-seed
 *
 * Requires CRM_DB_* (same as npm run db:exec). Dynamic-imports the shared lib after .env.local
 * so `db.ts` sees credentials.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(WEB_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

async function main() {
  loadEnvLocal();
  const force = process.argv.includes("--force");
  const { runDevTimTestQueueSeed } = await import("../lib/dev-tim-test-queue-seed");
  const result = await runDevTimTestQueueSeed({ force });
  if (!result.ok) {
    console.error("[seed-tim-test-queue]", result.error);
    process.exit(1);
  }
  console.log("[seed-tim-test-queue]", result.message);
  if (!result.alreadySeeded) {
    console.log(
      "  giWorkflowId:",
      result.giWorkflowId,
      "warmWorkflowId:",
      result.warmWorkflowId,
      "warmItemId:",
      result.warmItemId
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
