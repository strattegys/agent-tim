import { devQuery, devTransaction } from "./dev-store";

const USE_DEV_STORE = !process.env.CRM_DB_PASSWORD;

// Skip during `next build` / `npm run build` — .env is not loaded in the Docker build stage.
if (
  process.env.NODE_ENV === "production" &&
  USE_DEV_STORE &&
  process.env.npm_lifecycle_event !== "build"
) {
  console.warn(
    "[db] CRM_DB_PASSWORD is unset — using empty .dev-store JSON. Set CRM_DB_* + CRM_DB_HOST=host.docker.internal in web/.env.local for real CRM data."
  );
}

// Lazy-init pool only when we have a real DB
let _pool: import("pg").Pool | null = null;
function getPool(): import("pg").Pool {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg");
  if (!_pool) {
    _pool = new Pool({
      host: process.env.CRM_DB_HOST || "127.0.0.1",
      port: parseInt(process.env.CRM_DB_PORT || "5432"),
      database: process.env.CRM_DB_NAME || "default",
      user: process.env.CRM_DB_USER || "postgres",
      password: process.env.CRM_DB_PASSWORD,
      max: 5,
    });
  }
  return _pool;
}

const SCHEMA = "workspace_9rc10n79wgdr0r3z6mzti24f6";

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  if (USE_DEV_STORE) return devQuery(sql, params) as Promise<T[]>;

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
