import fs from "fs";
import { getLocalRuntimeLabel } from "./app-brand";
import { devQuery, devTransaction } from "./dev-store";

function isInsideLinuxDocker(): boolean {
  try {
    return fs.existsSync("/.dockerenv");
  } catch {
    return false;
  }
}

const USE_DEV_STORE = !process.env.CRM_DB_PASSWORD;

// Skip during `next build` / `npm run build` — .env is not loaded in the Docker build stage.
if (
  process.env.NODE_ENV === "production" &&
  USE_DEV_STORE &&
  process.env.npm_lifecycle_event !== "build"
) {
  console.warn(
    "[db] CRM_DB_PASSWORD is unset — using empty .dev-store JSON. Set CRM_DB_* in web/.env.local (Docker dev: CRM_DB_HOST=host.docker.internal + tunnel; production compose sets CRM_DB_HOST=crm-db)."
  );
}

function crmPoolOptions(): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string | undefined;
  max: number;
  connectionTimeoutMillis: number;
  keepAlive: boolean;
  keepAliveInitialDelayMillis: number;
  idleTimeoutMillis: number;
} {
  const connectionTimeoutMillis = parseInt(
    process.env.CRM_DB_CONNECTION_TIMEOUT_MS || "30000",
    10
  );
  const max = parseInt(process.env.CRM_DB_POOL_MAX || "5", 10);
  const keepAliveInitialDelayMillis = parseInt(
    process.env.CRM_DB_KEEPALIVE_DELAY_MS || "10000",
    10
  );
  let host = (process.env.CRM_DB_HOST || "127.0.0.1").trim();
  const h = host.toLowerCase();

  if (h === "crm-db" && !isInsideLinuxDocker()) {
    host = "127.0.0.1";
    const lp = parseInt(process.env.CRM_DB_LOCAL_PORT || "25432", 10);
    return {
      host,
      port: Number.isFinite(lp) && lp > 0 ? lp : 25432,
      database: process.env.CRM_DB_NAME || "default",
      user: process.env.CRM_DB_USER || "postgres",
      password: process.env.CRM_DB_PASSWORD,
      max: Number.isFinite(max) && max > 0 ? max : 5,
      connectionTimeoutMillis:
        Number.isFinite(connectionTimeoutMillis) && connectionTimeoutMillis > 0
          ? connectionTimeoutMillis
          : 30000,
      keepAlive: process.env.CRM_DB_KEEPALIVE === "0" ? false : true,
      keepAliveInitialDelayMillis:
        Number.isFinite(keepAliveInitialDelayMillis) && keepAliveInitialDelayMillis >= 0
          ? keepAliveInitialDelayMillis
          : 10000,
      idleTimeoutMillis: parseInt(process.env.CRM_DB_IDLE_TIMEOUT_MS || "30000", 10) || 30000,
    };
  }

  const defaultPort =
    h === "crm-db"
      ? 5432
      : h === "127.0.0.1" ||
          h === "localhost" ||
          h === "::1" ||
          h === "host.docker.internal"
        ? 5433
        : 5432;
  return {
    host,
    port: parseInt(process.env.CRM_DB_PORT || String(defaultPort), 10),
    database: process.env.CRM_DB_NAME || "default",
    user: process.env.CRM_DB_USER || "postgres",
    password: process.env.CRM_DB_PASSWORD,
    max: Number.isFinite(max) && max > 0 ? max : 5,
    connectionTimeoutMillis:
      Number.isFinite(connectionTimeoutMillis) && connectionTimeoutMillis > 0
        ? connectionTimeoutMillis
        : 30000,
    keepAlive: process.env.CRM_DB_KEEPALIVE === "0" ? false : true,
    keepAliveInitialDelayMillis:
      Number.isFinite(keepAliveInitialDelayMillis) && keepAliveInitialDelayMillis >= 0
        ? keepAliveInitialDelayMillis
        : 10000,
    idleTimeoutMillis: parseInt(process.env.CRM_DB_IDLE_TIMEOUT_MS || "30000", 10) || 30000,
  };
}

// Lazy-init pool only when we have a real DB
let _pool: import("pg").Pool | null = null;
function getPool(): import("pg").Pool {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg");
  if (!_pool) {
    _pool = new Pool(crmPoolOptions());
    _pool.on("error", (err: Error) => {
      console.warn("[db] Pool idle-client error (stale connection removed):", err.message);
    });
  }
  return _pool;
}

/**
 * Close the CRM pool so the next query opens fresh connections (prod: after idle DB blips;
 * dev: after SSH tunnel comes back). No-op when using .dev-store without CRM_DB_PASSWORD.
 */
export async function resetCrmPoolForReconnect(): Promise<void> {
  if (USE_DEV_STORE) return;
  const old = _pool;
  _pool = null;
  if (!old) return;
  try {
    await old.end();
  } catch {
    /* pool may already be closed */
  }
}

/** Resolved host + port the pool will actually connect to (same logic as crmPoolOptions). */
export function crmResolvedHostPort(): { host: string; port: number } {
  const opts = crmPoolOptions();
  return { host: opts.host, port: opts.port };
}

/**
 * Human-readable CRM target for Status rail / system-status (no secrets).
 * Leads with **LIVE CRM** vs **PRACTICE CRM** so architects see real vs sandbox at a glance.
 */
export function getCrmDataPlatformConnectionLabel(): string {
  if (!process.env.CRM_DB_PASSWORD?.trim()) {
    return "CRM not set up";
  }

  const configuredRaw = (process.env.CRM_DB_HOST || "127.0.0.1").trim();
  const ch = configuredRaw.toLowerCase();
  const { host, port } = crmResolvedHostPort();
  const hh = host.toLowerCase();
  const localRuntime = getLocalRuntimeLabel();

  if (ch === "crm-db" && isInsideLinuxDocker()) {
    if (localRuntime === "LOCALDEV") {
      return "PRACTICE CRM — local Docker only (not live pipelines)";
    }
    return "LIVE CRM — same database the hosted app uses";
  }

  if (ch === "crm-db" && !isInsideLinuxDocker()) {
    return "PRACTICE CRM — small database on this machine";
  }

  if ((hh === "127.0.0.1" || hh === "localhost" || hh === "::1") && port === 25432) {
    return "PRACTICE CRM — small database on this machine";
  }

  if (
    (hh === "127.0.0.1" || hh === "localhost" || hh === "::1" || hh === "host.docker.internal") &&
    port === 5433
  ) {
    return "LIVE CRM — dev screen, but data is the real cloud database (via this PC)";
  }

  if (/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hh)) {
    return "LIVE CRM — direct to cloud over your private network";
  }

  const ts = process.env.CRM_DB_TAILSCALE_HOST?.trim().toLowerCase();
  if (ts && hh === ts) {
    return "LIVE CRM — direct to cloud over your private network";
  }

  if (localRuntime === "LOCALPROD") {
    return `LIVE CRM — LOCALPROD (${host}:${port})`;
  }

  return `Other CRM target — ${host}:${port}`;
}

/**
 * When Data Platform uses a Tailscale 100.x host and Postgres returns ECONNREFUSED, the droplet
 * is usually not publishing crm-db on that address (run expose-crm-db-tailscale.sh) or Tailscale is down.
 */
export function crmTailscaleDirectRefusedHint(host: string): string {
  const h = host.trim();
  if (!/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return "";
  return (
    "Droplet must publish Postgres on this tailnet IP: ssh to Command Central, then " +
    "`cd /opt/agent-tim && bash tools/expose-crm-db-tailscale.sh` (requires `tailscale up` on the server). " +
    "On your PC: keep Tailscale connected. " +
    "Without tailnet: set CRM_LOCALPROD_DB_HOST=host.docker.internal, CRM_LOCALPROD_DB_PORT=5433, run scripts/localprod-crm-tunnel.ps1, recreate the web container."
  );
}

/** Twenty / CRM workspace schema (Kanban, workflows, person, _workflow_item, …). */
export const CRM_WORKSPACE_SCHEMA = "workspace_9rc10n79wgdr0r3z6mzti24f6";
const SCHEMA = CRM_WORKSPACE_SCHEMA;

let warnedDevStoreInDevelopment = false;

/** True when the CRM pool/TCP path died mid-flight (common with SSH tunnels + long gaps between queries). */
function isTransientCrmConnectionError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Connection terminated unexpectedly/i.test(msg)) return true;
  if (/Client has encountered a connection error/i.test(msg)) return true;
  if (/ECONNRESET|EPIPE|ETIMEDOUT|read ECONNRESET|write EPIPE/i.test(msg)) return true;
  const c = (e as { code?: string })?.code;
  if (c === "ECONNRESET" || c === "EPIPE" || c === "ETIMEDOUT") return true;
  return false;
}

async function runPooledQuery<T extends Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${SCHEMA}", public`);
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

const CRM_TRANSIENT_MAX_RETRIES = 3;
const CRM_TRANSIENT_BASE_DELAY_MS = 500;

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  if (USE_DEV_STORE) {
    if (
      process.env.NODE_ENV === "development" &&
      !warnedDevStoreInDevelopment
    ) {
      warnedDevStoreInDevelopment = true;
      console.warn(
        "[db] CRM_DB_PASSWORD is not set — Command Central is using .dev-store JSON, not Postgres. " +
          "Add CRM_DB_* to web/.env.local (and restart `next dev`) to use the same database as `npm run db:exec`."
      );
    }
    return devQuery(sql, params) as Promise<T[]>;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= CRM_TRANSIENT_MAX_RETRIES; attempt++) {
    try {
      return await runPooledQuery<T>(sql, params);
    } catch (e) {
      if (!isTransientCrmConnectionError(e)) throw e;
      lastError = e;
      await resetCrmPoolForReconnect();
      if (attempt < CRM_TRANSIENT_MAX_RETRIES) {
        const delayMs = Math.min(CRM_TRANSIENT_BASE_DELAY_MS * Math.pow(2, attempt), 4000);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

/** Run multiple statements in a transaction. Returns the result of the callback. */
export async function transaction<T>(
  fn: (run: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>
): Promise<T> {
  if (USE_DEV_STORE) return devTransaction(fn);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${SCHEMA}", public`);
    await client.query("BEGIN");
    const result = await fn((sql, params) => client.query(sql, params));
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
