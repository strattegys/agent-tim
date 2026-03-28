import { NextResponse } from "next/server";
import { Client } from "pg";
import { auth } from "@/lib/auth";
import { CRM_WORKSPACE_SCHEMA, resetCrmPoolForReconnect } from "@/lib/db";

export const runtime = "nodejs";

const PROBE_MS = 8000;

/**
 * POST /api/crm/reconnect-db — authenticated only.
 * Drops the server-side CRM connection pool and probes Postgres (same checks as Data platform).
 * Does not start an SSH tunnel (impossible from the server, especially inside Docker dev).
 */
export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const password = process.env.CRM_DB_PASSWORD?.trim();
  if (!password) {
    return NextResponse.json({
      ok: false,
      dataPlatform: "skipped",
      message: "CRM_DB_PASSWORD is not set — configure web/.env.local or use dev store.",
    });
  }

  await resetCrmPoolForReconnect();

  const host = process.env.CRM_DB_HOST || "127.0.0.1";
  const port = parseInt(process.env.CRM_DB_PORT || "5432", 10);
  const target = `${host}:${port}`;

  const client = new Client({
    host,
    port,
    database: process.env.CRM_DB_NAME || "default",
    user: process.env.CRM_DB_USER || "postgres",
    password,
    connectionTimeoutMillis: PROBE_MS,
  });

  const t0 = Date.now();
  try {
    await client.connect();
    await client.query("SELECT 1");
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = '_workflow_item'
      ) AS ok`,
      [CRM_WORKSPACE_SCHEMA]
    );
    const ms = Date.now() - t0;
    await client.end();

    const schemaOk = Boolean(rows[0]?.ok);
    if (!schemaOk) {
      return NextResponse.json({
        ok: false,
        dataPlatform: "schema",
        ms,
        target,
        message:
          "Connected to Postgres but workspace schema is incomplete (no _workflow_item). Run web/scripts/migrate-workflows.sql on this database.",
      });
    }

    return NextResponse.json({
      ok: true,
      dataPlatform: "ok",
      ms,
      target,
      message: "CRM connection pool reset and Postgres probe succeeded.",
    });
  } catch (e) {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    const msg = e instanceof Error ? e.message : String(e);
    const isConn =
      /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout/i.test(msg) ||
      msg.toLowerCase().includes("connect");
    const devTunnelHint =
      process.env.NODE_ENV === "development" && /ECONNREFUSED/i.test(msg)
        ? " On your machine, restart the SSH tunnel (e.g. cd web && npm run db:reconnect, or COMMAND-CENTRAL/scripts/crm-db-tunnel.ps1). The app cannot open that tunnel for you from the browser."
        : "";
    const prodHint =
      process.env.NODE_ENV === "production" && isConn
        ? " If crm-db was restarted, this button clears stale pool connections; if it still fails, check docker compose on the host."
        : "";

    return NextResponse.json({
      ok: false,
      dataPlatform: "down",
      target,
      error: msg.slice(0, 200),
      message: `Could not reach CRM Postgres at ${target}.${devTunnelHint}${prodHint}`.slice(0, 600),
    });
  }
}
