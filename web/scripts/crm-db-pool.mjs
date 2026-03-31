/**
 * Create a pg Pool for the CRM database with the same host/port defaults and Tailscale fallback as
 * scripts/check-crm-db.mjs (loopback tunnel down → CRM_DB_TAILSCALE_HOST:5432).
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");

function mergeEnvLocal(webRoot) {
  const envPath = path.join(webRoot, ".env.local");
  if (!fs.existsSync(envPath)) return;
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

/** True when this Node process runs inside a Linux container (Next in Docker, `docker compose exec`, etc.). */
function isInsideLinuxDocker() {
  try {
    return fs.existsSync("/.dockerenv");
  } catch {
    return false;
  }
}

/**
 * When `.env.local` says CRM_DB_HOST=crm-db (meant for the web container), host-side CLI cannot resolve it.
 * LOCALDEV publishes Postgres on the host as 127.0.0.1:25432 (docker-compose.dev.yml).
 */
function resolveDiscreteCrmHostPort() {
  const configuredHost = (process.env.CRM_DB_HOST || "127.0.0.1").trim();
  const hl = configuredHost.toLowerCase();

  if (hl === "crm-db" && !isInsideLinuxDocker()) {
    return {
      host: "127.0.0.1",
      port: parseInt(process.env.CRM_DB_LOCAL_PORT || "25432", 10),
    };
  }

  const defaultPort =
    hl === "crm-db"
      ? 5432
      : hl === "127.0.0.1" ||
          hl === "localhost" ||
          hl === "::1" ||
          hl === "host.docker.internal"
        ? 5433
        : 5432;
  const fromEnv = parseInt(process.env.CRM_DB_PORT || "", 10);
  const port = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : defaultPort;
  return { host: configuredHost, port };
}

function shouldTryTailscaleFallback(primaryHost) {
  const h = (primaryHost || "").trim().toLowerCase();
  if (!h) return false;
  if (h === "127.0.0.1" || h === "localhost" || h === "::1") return true;
  if (h === "host.docker.internal" || h.includes("host.docker.internal")) return true;
  return false;
}

/**
 * @param {string} webRoot - e.g. COMMAND-CENTRAL/web (parent of scripts/)
 */
export async function createCrmPool(webRoot) {
  mergeEnvLocal(webRoot);

  const url = process.env.CRM_DATABASE_URL || process.env.DATABASE_URL;
  const password = process.env.CRM_DB_PASSWORD;
  if (!url && !password) {
    throw new Error(
      "Missing CRM DB credentials: set CRM_DB_PASSWORD (and CRM_DB_*) or DATABASE_URL / CRM_DATABASE_URL in web/.env.local"
    );
  }

  const database = process.env.CRM_DB_NAME || "default";
  const user = process.env.CRM_DB_USER || "postgres";
  const connTimeout = parseInt(process.env.CRM_DB_CONNECTION_TIMEOUT_MS || "30000", 10) || 30000;
  const keepAlive = process.env.CRM_DB_KEEPALIVE === "0" ? false : true;

  if (url && String(url).trim()) {
    const pool = new Pool({
      connectionString: url,
      max: 2,
      connectionTimeoutMillis: connTimeout,
      keepAlive,
    });
    const c = await pool.connect();
    c.release();
    return pool;
  }

  const { host: configuredHost, port } = resolveDiscreteCrmHostPort();
  const tsFallbackHost = (process.env.CRM_DB_TAILSCALE_HOST || "100.74.54.12").trim();
  const TS_FALLBACK_PORT = 5432;

  async function probePool(host, portNum) {
    const pool = new Pool({
      host,
      port: portNum,
      database,
      user,
      password,
      max: 2,
      connectionTimeoutMillis: connTimeout,
      keepAlive,
    });
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
    return pool;
  }

  try {
    return await probePool(configuredHost, port);
  } catch (primaryErr) {
    if (shouldTryTailscaleFallback(configuredHost) && tsFallbackHost) {
      console.error(
        `[crm-db-pool] ${configuredHost}:${port} — ${primaryErr?.message || primaryErr}; trying Tailscale ${tsFallbackHost}:${TS_FALLBACK_PORT}…`
      );
      return await probePool(tsFallbackHost, TS_FALLBACK_PORT);
    }
    throw primaryErr;
  }
}
