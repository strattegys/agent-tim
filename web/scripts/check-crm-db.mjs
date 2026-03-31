/**
 * Verify CRM Postgres is reachable (same path as Next.js / SSH tunnel).
 * Run:  cd web && npm run check-crm-db
 * process.env wins over .env.local so docker-compose.dev.yml overrides (host/port) apply in-container.
 *
 * If your primary host is 127.0.0.1 / host.docker.internal and the tunnel is down, this script
 * automatically tries Tailscale direct (CRM_DB_TAILSCALE_HOST, default CC node 100.74.54.12:5432).
 * Pass --no-tailscale-fallback to disable.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");

function parseEnvLocal(file) {
  const out = {};
  if (!fs.existsSync(file)) {
    return out;
  }
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

const noTsFallback = process.argv.includes("--no-tailscale-fallback");
const password = pick("CRM_DB_PASSWORD");
const database = pick("CRM_DB_NAME", "default");
const user = pick("CRM_DB_USER", "postgres");
let configuredHost = pick("CRM_DB_HOST");
const defaultPort =
  (configuredHost || "").toLowerCase() === "crm-db" ? "5432" : "5433";
let port = parseInt(pick("CRM_DB_PORT", defaultPort), 10);
const connTimeout = parseInt(pick("CRM_DB_CONNECTION_TIMEOUT_MS", "20000"), 10) || 20000;
const tsFallbackHost = pick("CRM_DB_TAILSCALE_HOST", "100.74.54.12").trim();
const TS_FALLBACK_PORT = 5432;

if (!password) {
  console.error(
    "CRM_DB_PASSWORD is missing — add to web/.env.local or inject via Docker compose env_file."
  );
  process.exit(1);
}

let host =
  configuredHost && configuredHost !== ""
    ? configuredHost
    : "127.0.0.1";

function isInsideLinuxDocker() {
  try {
    return fs.existsSync("/.dockerenv");
  } catch {
    return false;
  }
}

/* Host-side Node: `crm-db` only resolves inside Compose; LOCALDEV publishes DB on 127.0.0.1:25432 */
if (host.toLowerCase() === "crm-db" && !isInsideLinuxDocker()) {
  host = "127.0.0.1";
  port = parseInt(pick("CRM_DB_LOCAL_PORT", "25432"), 10);
}

const SCHEMA = "workspace_9rc10n79wgdr0r3z6mzti24f6";

function shouldTryTailscaleFallback(primaryHost) {
  if (noTsFallback) return false;
  const h = (primaryHost || "").trim().toLowerCase();
  if (!h) return false;
  if (h === "127.0.0.1" || h === "localhost" || h === "::1") return true;
  if (h.includes("host.docker.internal")) return true;
  return false;
}

function looksLikeTailscaleHost(h) {
  const t = (h || "").trim();
  return t.startsWith("100.");
}

async function runProbe(hostName, portNum) {
  const client = new pg.Client({
    host: hostName,
    port: portNum,
    database,
    user,
    password,
    connectionTimeoutMillis: connTimeout,
    keepAlive: true,
  });
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
    return { ok: true, hasVector, hasMemory, error: null };
  } catch (e) {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      hasVector: false,
      hasMemory: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const primary = await runProbe(host, port);

if (primary.ok) {
  if (!primary.hasVector || !primary.hasMemory) {
    console.error(
      `CRM Postgres at ${host}:${port} is reachable but agent vector memory is not ready:` +
        ` vector extension=${primary.hasVector ? "yes" : "NO"}` +
        ` ; _memory table=${primary.hasMemory ? "yes" : "NO"}.` +
        `\nFix: use crm-db image pgvector/pgvector:pg16 and run (repo root):\n` +
        `  docker compose --env-file web/.env.local -f docker-compose.yml exec -T crm-db psql -U postgres -d default -v ON_ERROR_STOP=1 < web/scripts/migrate-vector-memory.sql`
    );
    process.exit(1);
  }
  console.log(
    `OK — CRM Postgres at ${host}:${port} (pgvector + _memory in ${SCHEMA}).`
  );
  process.exit(0);
}

console.error("CRM DB check failed (primary):", primary.error);
console.error(`  Tried: ${host}:${port}`);

if (shouldTryTailscaleFallback(host) && tsFallbackHost) {
  console.error(
    `\nTrying Tailscale direct fallback ${tsFallbackHost}:${TS_FALLBACK_PORT} (set CRM_DB_TAILSCALE_HOST to override)…`
  );
  const fb = await runProbe(tsFallbackHost, TS_FALLBACK_PORT);
  if (fb.ok && fb.hasVector && fb.hasMemory) {
    console.log(
      `\nOK via Tailscale — CRM Postgres at ${tsFallbackHost}:${TS_FALLBACK_PORT}.\n` +
        `\nYour tunnel/loopback path is broken. To fix Data Platform + dev app, add to web/.env.local:\n` +
        `  CRM_DB_HOST=${tsFallbackHost}\n` +
        `  CRM_DB_PORT=${TS_FALLBACK_PORT}\n` +
        `\n(Or start the tunnel: COMMAND-CENTRAL\\\\scripts\\\\crm-db-tunnel.ps1)\n` +
        `Confirm the CC node IP in PROJECT-MEMORY.md section 3 if this ever stops working.\n`
    );
    process.exit(0);
  }
  if (fb.ok && (!fb.hasVector || !fb.hasMemory)) {
    console.error(
      "Tailscale host answered but vector/_memory checks failed — same fix as primary (migrate-vector-memory.sql)."
    );
    process.exit(1);
  }
  console.error("Tailscale fallback also failed:", fb.error);
  console.error(
    `\nOn the Command Central droplet (SSH), re-publish Postgres on the tailnet:\n` +
      `  cd /opt/agent-tim && bash tools/expose-crm-db-tailscale.sh\n` +
      `Requires tailscale up on the server and docker compose with web/.env.local.\n`
  );
} else if (looksLikeTailscaleHost(host)) {
  console.error(
    `\nYou are already using a Tailscale-style host (${host}) but Postgres did not answer.\n` +
      `On the CC droplet run:\n` +
      `  cd /opt/agent-tim && bash tools/expose-crm-db-tailscale.sh\n` +
      `Or use the SSH tunnel: COMMAND-CENTRAL\\\\scripts\\\\crm-db-tunnel.ps1\n`
  );
} else {
  console.error(
    `\nTunnel path: COMMAND-CENTRAL\\\\scripts\\\\crm-db-tunnel.ps1 (or bash scripts/crm-db-tunnel.sh)\n` +
      `Set CRM_SSH_HOST to the CC node Tailscale IP or MagicDNS name if needed.\n`
  );
}

process.exit(1);
