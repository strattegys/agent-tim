/**
 * Move legacy LinkedIn **connection accepted** rows off `linkedin-general-inbox` onto
 * `linkedin-connection-intake` (same `_workflow_item.id`, updates workflow + stage + artifacts).
 *
 * Heuristic: general inbox, stage LINKEDIN_INBOUND, has artifact named "LinkedIn: connection accepted",
 * and does **not** have "LinkedIn: inbound message".
 *
 * Usage (from web/):
 *   npm run migrate:linkedin-connection-intake
 *   npm run migrate:linkedin-connection-intake -- --dry-run
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

const dryRun = process.argv.includes("--dry-run");

async function main() {
  loadEnvLocal();
  const { query } = await import("../lib/db");
  const { ensureLinkedInConnectionIntakeWorkflowId } = await import(
    "../lib/linkedin-connection-intake"
  );
  const { syncHumanTaskOpenForItem } = await import("../lib/workflow-item-human-task");

  const intakeWfId = await ensureLinkedInConnectionIntakeWorkflowId();

  const giRows = await query<{ id: string }>(
    `SELECT w.id
     FROM "_workflow" w
     WHERE w."deletedAt" IS NULL
       AND w."packageId" IS NULL
       AND LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = 'tim'
       AND (
         COALESCE(w.spec::text, '') LIKE '%"workflowType":"linkedin-general-inbox"%'
         OR COALESCE(w.spec::text, '') LIKE '%"workflowType": "linkedin-general-inbox"%'
       )
     ORDER BY w."createdAt" ASC
     LIMIT 1`
  );
  const giWfId = giRows[0]?.id;
  if (!giWfId) {
    console.log("[migrate] No linkedin-general-inbox workflow found — nothing to do.");
    return;
  }

  const candidates = await query<{ id: string; sourceId: string }>(
    `SELECT wi.id, wi."sourceId"::text AS "sourceId"
     FROM "_workflow_item" wi
     WHERE wi."workflowId" = $1::uuid
       AND UPPER(TRIM(wi.stage::text)) = 'LINKEDIN_INBOUND'
       AND wi."deletedAt" IS NULL
       AND wi."sourceType" = 'person'
       AND EXISTS (
         SELECT 1 FROM "_artifact" a
         WHERE a."workflowItemId" = wi.id AND a."deletedAt" IS NULL
           AND a.name = 'LinkedIn: connection accepted'
       )
       AND NOT EXISTS (
         SELECT 1 FROM "_artifact" a2
         WHERE a2."workflowItemId" = wi.id AND a2."deletedAt" IS NULL
           AND a2.name = 'LinkedIn: inbound message'
       )`,
    [giWfId]
  );

  console.log(
    `[migrate] general-inbox wf=${giWfId.slice(0, 8)}… → intake wf=${intakeWfId.slice(0, 8)}… candidates=${candidates.length} dryRun=${dryRun}`
  );

  let moved = 0;
  let skipped = 0;

  for (const c of candidates) {
    const dup = await query<{ id: string }>(
      `SELECT id FROM "_workflow_item"
       WHERE "workflowId" = $1::uuid AND "sourceType" = 'person' AND "sourceId"::text = $2
         AND "deletedAt" IS NULL AND id <> $3::uuid`,
      [intakeWfId, c.sourceId, c.id]
    );
    if (dup.length > 0) {
      console.log(
        `[migrate] skip item ${c.id.slice(0, 8)}… — person already has another row on connection intake`
      );
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`[migrate] would move item ${c.id} person ${c.sourceId.slice(0, 8)}…`);
      moved++;
      continue;
    }

    await query(
      `UPDATE "_workflow_item"
       SET "workflowId" = $1::uuid, stage = 'CONNECTION_ACCEPTED', "updatedAt" = NOW()
       WHERE id = $2::uuid AND "deletedAt" IS NULL`,
      [intakeWfId, c.id]
    );
    await query(
      `UPDATE "_artifact"
       SET "workflowId" = $1::uuid, stage = 'CONNECTION_ACCEPTED', "updatedAt" = NOW()
       WHERE "workflowItemId" = $2::uuid AND "deletedAt" IS NULL`,
      [intakeWfId, c.id]
    );
    await syncHumanTaskOpenForItem(c.id);
    console.log(`[migrate] moved item ${c.id.slice(0, 8)}…`);
    moved++;
  }

  console.log(`[migrate] done moved=${moved} skipped=${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
