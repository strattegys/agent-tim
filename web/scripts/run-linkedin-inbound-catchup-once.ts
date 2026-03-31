/**
 * One-shot Unipile inbound catch-up (same as cron). From web/:
 *   npm run cron:linkedin-inbound-catchup
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

async function main() {
  loadEnvLocal();
  const { runLinkedInInboundCatchupCron } = await import("../lib/linkedin-inbound-catchup");
  const r = await runLinkedInInboundCatchupCron();
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
