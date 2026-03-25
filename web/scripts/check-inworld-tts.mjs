/**
 * Quick check: is INWORLD_TTS_KEY non-empty in web/.env.local?
 * Run from repo:  cd web && node scripts/check-inworld-tts.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");

if (!fs.existsSync(envPath)) {
  console.error("No web/.env.local — copy web/.env.local.example and fill in keys.");
  process.exit(1);
}

const raw = fs.readFileSync(envPath, "utf8");
let value = "";
for (const line of raw.split("\n")) {
  const trimmed = line.trim();
  if (trimmed.startsWith("#") || !trimmed) continue;
  const m = trimmed.match(/^INWORLD_TTS_KEY=(.*)$/);
  if (m) {
    value = m[1].trim().replace(/^["']|["']$/g, "");
    break;
  }
}

if (value.length > 0) {
  console.log("OK — INWORLD_TTS_KEY is set (length %d). Restart Docker after changes.", value.length);
  process.exit(0);
}

console.error(
  "INWORLD_TTS_KEY is missing or empty — Suzi (and /api/tts) will return 503.\n" +
    "Copy the same key Rainbow uses: PROJECT-SERVER/rainbow env INWORLD_TTS_KEY (see avabot_server.py)."
);
process.exit(1);
