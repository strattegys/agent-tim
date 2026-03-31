/**
 * Lists dedupe receipts that were claimed but never finalized (stuck), plus recent failures.
 *
 * From web/:
 *   npm run check:linkedin-inbound-orphans
 *
 * Requires: npm run db:exec -- scripts/migrate-linkedin-inbound-receipt-outcome.sql
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
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

async function main() {
  loadEnvLocal();
  const { query } = await import("../lib/db");
  const { listInboundReceiptOrphans } = await import("../lib/linkedin-inbound-receipt");

  const olderThan = 20;
  const orphans = await listInboundReceiptOrphans({ olderThanMinutes: olderThan, limit: 80 });
  console.log(
    `Orphan receipts (processedAt IS NULL, older than ${olderThan} min): ${orphans.length}`
  );
  for (const o of orphans.slice(0, 25)) {
    const mid =
      o.unipileMessageId.length > 52 ? `${o.unipileMessageId.slice(0, 52)}…` : o.unipileMessageId;
    console.log(
      `  ${o.createdAt.toISOString()}  ${o.eventKind}  person=${o.personId.slice(0, 8)}…  ${o.senderDisplayName || "?"}  ${mid}`
    );
  }
  if (orphans.length > 25) console.log(`  … ${orphans.length - 25} more`);

  try {
    const failed = await query<{
      unipileMessageId: string;
      processNote: string | null;
      createdAt: Date;
    }>(
      `SELECT "unipileMessageId", "processNote", "createdAt"
       FROM "_linkedin_inbound_receipt"
       WHERE "processNote" IS NOT NULL
         AND "processNote" NOT LIKE 'legacy%'
       ORDER BY "createdAt" DESC
       LIMIT 15`
    );
    if (failed.length > 0) {
      console.log("\nRecent processing notes (failed / partial):");
      for (const f of failed) {
        const note = (f.processNote || "").slice(0, 120);
        console.log(`  ${f.createdAt.toISOString()}  ${note}`);
      }
    }
  } catch {
    console.log("\n(processNote column missing — run migrate-linkedin-inbound-receipt-outcome.sql)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
