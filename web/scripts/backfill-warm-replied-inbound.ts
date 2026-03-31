#!/usr/bin/env node
/**
 * Pull latest inbound LinkedIn text from Unipile into CRM (REPLIED + REPLY_DRAFT prefix).
 * Defaults to first name **Jebin**. Needs web/.env.local: CRM_DB_*, UNIPILE_*.
 *
 * `cd web && npm run backfill:jebin`
 * Other: `--first-name=Ann` · by item: `--workflow-item-id=<uuid>` · `--dry-run` · `-v`
 */

import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  backfillWarmRepliedInboundFromFirstName,
  backfillWarmRepliedInboundFromWorkflowItemId,
} from "../lib/warm-replied-inbound-backfill";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "..");

function parseArgs() {
  const argv = process.argv.slice(2);
  let dryRun = false;
  let verbose = false;
  let firstName = "Jebin";
  let workflowItemId: string | null = null;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else if (a === "--verbose" || a === "-v") verbose = true;
    else if (a.startsWith("--first-name=")) firstName = a.slice("--first-name=".length).trim() || firstName;
    else if (a.startsWith("--workflow-item-id=")) {
      workflowItemId = a.slice("--workflow-item-id=".length).trim() || null;
    }
  }
  return { dryRun, firstName, workflowItemId, verbose };
}

async function withDbReconnect<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout|connect/i.test(msg)) throw e;
    console.error("CRM database unreachable — running `npm run db:reconnect` once, then retrying…");
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    spawnSync(npm, ["run", "db:reconnect"], {
      cwd: WEB_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    await new Promise((r) => setTimeout(r, 2500));
    try {
      return await fn();
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      throw new Error(
        `${m}\nStill no database. Turn on Tailscale (or run ssh -L for Postgres to Command Central), then run this command again.`
      );
    }
  }
}

async function main() {
  const { dryRun, firstName, workflowItemId, verbose } = parseArgs();
  const log = (...args: unknown[]) => {
    if (verbose || dryRun) console.log(...args);
  };

  const run = () =>
    workflowItemId
      ? backfillWarmRepliedInboundFromWorkflowItemId(workflowItemId, { dryRun })
      : backfillWarmRepliedInboundFromFirstName(firstName, { dryRun });

  let result;
  try {
    result = await withDbReconnect(run);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }

  if (dryRun) {
    log("[dry-run] No writes. Preview:", result.inboundPreview);
    return;
  }

  log(result.draftUpdated ? "REPLY_DRAFT prefix updated." : "REPLY_DRAFT left as-is.");
  console.log(
    `OK — ${result.firstName} ${result.lastName}: CRM updated with their latest LinkedIn message. Refresh Tim. “${result.inboundPreview}”`
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
