#!/usr/bin/env node
/**
 * Remove legacy LinkedIn **connection** lines from web_notifications.jsonl (disk cleanup).
 * Rules must stay aligned with web/lib/notification-filters.ts (isLinkedInConnectionBellNoise).
 *
 * Usage (droplet / Docker host):
 *   WEB_NOTIFICATIONS_FILE=/path/to/web_notifications.jsonl node scripts/prune-linkedin-connection-notifications.mjs
 *
 * Default file: /root/.nanobot/web_notifications.jsonl
 */
import fs from "fs";
import path from "path";

function isNoise(n) {
  if (n.type !== "linkedin_inbound") return false;
  const t = (n.title || "").trim();
  if (t.startsWith("New LinkedIn Connection:")) return true;
  if (t.startsWith("Connection Accepted:")) return true;
  if (/^LinkedIn: .+ accepted \(inbox\)$/.test(t)) return true;
  return false;
}

const file =
  process.env.WEB_NOTIFICATIONS_FILE ||
  process.env.NOTIFICATIONS_FILE ||
  "/root/.nanobot/web_notifications.jsonl";

if (!fs.existsSync(file)) {
  console.log(`[prune-notifications] No file at ${file} — nothing to do.`);
  process.exit(0);
}

const raw = fs.readFileSync(file, "utf8").trim();
if (!raw) {
  console.log("[prune-notifications] File empty — nothing to do.");
  process.exit(0);
}

const lines = raw.split("\n");
let kept = 0;
let dropped = 0;
const out = [];

for (const line of lines) {
  let n = null;
  try {
    n = JSON.parse(line);
  } catch {
    out.push(line);
    kept++;
    continue;
  }
  if (isNoise(n)) {
    dropped++;
    continue;
  }
  out.push(line);
  kept++;
}

if (dropped === 0) {
  console.log(`[prune-notifications] No matching lines in ${file} (${kept} lines total).`);
  process.exit(0);
}

const dir = path.dirname(file);
const base = path.basename(file);
const tmp = path.join(dir, `.${base}.tmp.${process.pid}`);

fs.writeFileSync(tmp, out.length ? out.join("\n") + "\n" : "", "utf8");
fs.renameSync(tmp, file);

console.log(
  `[prune-notifications] Wrote ${file}: kept ${kept} line(s), removed ${dropped} LinkedIn connection alert(s).`
);
