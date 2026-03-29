#!/usr/bin/env node
/**
 * Verify Gemini API key is visible the same way db-exec loads web/.env.local.
 * Usage (from web/): npm run check-gemini-env
 *
 * Does not print the key — only whether it is set and which env name matched.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(WEB_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("[check-gemini-env] Missing web/.env.local — copy from .env.local.example");
    process.exit(1);
  }
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

const NAMES = [
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GEMINI_API_KEY",
];

loadEnvLocal();
for (const name of NAMES) {
  const v = process.env[name]?.trim();
  if (v) {
    console.log(`OK — ${name} is set (${v.length} characters).`);
    console.log(
      "If Next still reports a missing key: restart `next dev` or `docker compose -f docker-compose.dev.yml restart web`."
    );
    process.exit(0);
  }
}
console.error(
  "[check-gemini-env] No Gemini key found. Add one of:\n  " +
    NAMES.join("\n  ") +
    "\nto web/.env.local (no quotes needed unless the value has spaces)."
);
process.exit(1);
