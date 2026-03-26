/**
 * Verify CRM Postgres is reachable (same path as Next.js / SSH tunnel).
 * Run:  cd web && npm run check-crm-db
 * process.env wins over .env.local so docker-compose.dev.yml overrides (host/port) apply in-container.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");

function parseEnvLocal(file) {
  if (!fs.existsSync(file)) {
    console.error("Missing web/.env.local — copy web/.env.local.example");
    process.exit(1);
  }
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    out[m[1]] = v;
  }
  return out;
}

const file = parseEnvLocal(envPath);
const pick = (k, def = "") => {
  const v = process.env[k]?.trim();
  if (v) return v;
  const f = file[k]?.trim();
  return f || def;
};
const password = pick("CRM_DB_PASSWORD");
const port = parseInt(pick("CRM_DB_PORT", "5433"), 10);
const database = pick("CRM_DB_NAME", "default");
const user = pick("CRM_DB_USER", "postgres");
const configuredHost = pick("CRM_DB_HOST");

if (!password) {
  console.error("CRM_DB_PASSWORD is missing in web/.env.local");
  process.exit(1);
}

const host =
  configuredHost && configuredHost !== ""
    ? configuredHost
    : "127.0.0.1";

const client = new pg.Client({
  host,
  port,
  database,
  user,
  password,
  connectionTimeoutMillis: 5000,
});

const SCHEMA = "workspace_9rc10n79wgdr0r3z6mzti24f6";

try {
  await client.connect();
  await client.query("SELECT 1");

  const ext = await client.query(
    "SELECT 1 AS ok FROM pg_extension WHERE extname = 'vector' LIMIT 1"
  );
  const hasVector = ext.rows.length > 0;

  const mem = await client.query(
    `SELECT 1 AS ok FROM information_schema.tables
     WHERE table_schema = $1 AND table_name = '_memory' LIMIT 1`,
    [SCHEMA]
  );
  const hasMemory = mem.rows.length > 0;

  await client.end();

  if (!hasVector || !hasMemory) {
    console.error(
      `CRM Postgres at ${host}:${port} is reachable but agent vector memory is not ready:` +
        ` vector extension=${hasVector ? "yes" : "NO"}` +
        ` ; _memory table=${hasMemory ? "yes" : "NO"}.` +
        `\nFix: use crm-db image pgvector/pgvector:pg16 and run (repo root):\n` +
        `  docker compose --env-file web/.env.local -f docker-compose.yml exec -T crm-db psql -U postgres -d default -v ON_ERROR_STOP=1 < web/scripts/migrate-vector-memory.sql`
    );
    process.exit(1);
  }

  console.log(
    `OK — CRM Postgres at ${host}:${port} (pgvector + _memory in ${SCHEMA}).`
  );
  process.exit(0);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("CRM DB check failed:", msg);
  console.error(
    "\nStart tunnel (from COMMAND-CENTRAL): .\\scripts\\crm-db-tunnel.ps1 or bash scripts/crm-db-tunnel.sh"
  );
  try { await client.end(); } catch { /* ignore */ }
  process.exit(1);
}
