import "server-only";

import fs from "fs";
import path from "path";

let merged = false;

/**
 * Merge `web/.env.local` into `process.env` for keys that are missing or empty.
 * Next.js usually loads this file, but Docker + `next dev` and worker processes can leave
 * variables like `BRAVE_SEARCH_API_KEY` unset even when the file on disk has them.
 * Same merge rules as `scripts/db-exec.mjs` (no overwrite of non-empty env).
 */
export function mergeWebEnvLocalSync(): void {
  if (merged) return;
  merged = true;

  const candidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), "web", ".env.local"),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;

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
    return;
  }
}
