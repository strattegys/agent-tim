import { devQuery, devTransaction } from "./dev-store";

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
  return {
    host: process.env.CRM_DB_HOST || "127.0.0.1",
    port: parseInt(process.env.CRM_DB_PORT || "5432", 10),
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

  try {
    return await runPooledQuery<T>(sql, params);
  } catch (e) {
    if (!isTransientCrmConnectionError(e)) throw e;
    await resetCrmPoolForReconnect();
    return runPooledQuery<T>(sql, params);
  }
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
