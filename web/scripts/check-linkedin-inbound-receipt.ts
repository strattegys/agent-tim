/**
 * Read-only: row count and latest receipts for LinkedIn inbound dedupe table.
 *
 * Usage (from web/):
 *   npx tsx scripts/check-linkedin-inbound-receipt.ts
 *
 * Apply migration first: npm run db:linkedin-inbound-receipt
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

  type Row = {
    id: string;
    unipileMessageId: string;
    eventKind: string;
    "createdAt": Date;
  };

  try {
    const [{ count }] = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "_linkedin_inbound_receipt"`
    );
    console.log(`[_linkedin_inbound_receipt] total rows: ${count}`);

    const recent = await query<Row>(
      `SELECT id, "unipileMessageId", "eventKind", "createdAt"
       FROM "_linkedin_inbound_receipt"
       ORDER BY "createdAt" DESC
       LIMIT 15`
    );
    if (recent.length === 0) {
      console.log("  (no rows yet)");
      return;
    }
    for (const r of recent) {
      const mid = r.unipileMessageId.length > 56 ? `${r.unipileMessageId.slice(0, 56)}…` : r.unipileMessageId;
      console.log(`  ${r.createdAt.toISOString()}  ${r.eventKind}  ${mid}`);
    }
  } catch (e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
    if (code === "42P01") {
      console.error(
        'Table "_linkedin_inbound_receipt" is missing. Run: npm run db:linkedin-inbound-receipt'
      );
      process.exit(1);
    }
    throw e;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
