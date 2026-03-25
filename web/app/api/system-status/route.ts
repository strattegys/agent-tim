import { NextResponse } from "next/server";
import { Client } from "pg";

const PROBE_MS = 4000;

type ProbeStatus = "ok" | "down" | "skipped";

interface ProbeResult {
  id: string;
  label: string;
  status: ProbeStatus;
  ms?: number;
  detail?: string;
}

async function probeHttp(
  id: string,
  label: string,
  url: string | undefined,
  path = ""
): Promise<ProbeResult> {
  if (!url?.trim()) {
    return { id, label, status: "skipped", detail: "not configured" };
  }
  let target: string;
  try {
    const u = new URL(url);
    target = path ? `${u.origin}${path}` : u.href;
  } catch {
    return { id, label, status: "skipped", detail: "bad URL" };
  }

  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_MS);
  try {
    const res = await fetch(target, {
      method: "GET",
      signal: ac.signal,
      redirect: "follow",
      headers: { Accept: "text/html,application/json,*/*" },
    });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    if (res.ok || (res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403) {
      return { id, label, status: "ok", ms };
    }
    return { id, label, status: "down", ms, detail: `HTTP ${res.status}` };
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    return { id, label, status: "down", detail: msg.includes("abort") ? "timeout" : msg.slice(0, 48) };
  }
}

const DATA_PLATFORM_ID = "data_platform";
const DATA_PLATFORM_LABEL = "Data platform";

/**
 * Postgres is what Kanban / human-tasks / packages use. Probing Twenty's web URL
 * often fails in production (UI not reachable from the app host) even when DB is fine.
 */
async function probeCrmPostgres(): Promise<ProbeResult> {
  const password = process.env.CRM_DB_PASSWORD?.trim();
  if (!password) {
    return {
      id: DATA_PLATFORM_ID,
      label: DATA_PLATFORM_LABEL,
      status: "skipped",
      detail: "CRM_DB_PASSWORD not set",
    };
  }

  const client = new Client({
    host: process.env.CRM_DB_HOST || "127.0.0.1",
    port: parseInt(process.env.CRM_DB_PORT || "5432", 10),
    database: process.env.CRM_DB_NAME || "default",
    user: process.env.CRM_DB_USER || "postgres",
    password,
    connectionTimeoutMillis: PROBE_MS,
  });

  const t0 = Date.now();
  try {
    await client.connect();
    await client.query("SELECT 1");
    const ms = Date.now() - t0;
    await client.end();
    return {
      id: DATA_PLATFORM_ID,
      label: DATA_PLATFORM_LABEL,
      status: "ok",
      ms,
      detail: "postgres",
    };
  } catch (e) {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    const msg = e instanceof Error ? e.message : String(e);
    let detail = msg.slice(0, 88);
    if (/ECONNREFUSED/i.test(msg) && /5432/.test(msg)) {
      detail =
        (detail + " → host:5432 empty or use docker-compose.crm-network.yml").slice(0, 140);
    }
    return {
      id: DATA_PLATFORM_ID,
      label: DATA_PLATFORM_LABEL,
      status: "down",
      detail,
    };
  }
}

/** Prefer CRM Postgres when configured; otherwise optional HTTP check to Twenty URL. */
async function probeDataPlatform(): Promise<ProbeResult> {
  if (process.env.CRM_DB_PASSWORD?.trim()) {
    return probeCrmPostgres();
  }
  const twentyBase = process.env.TWENTY_CRM_URL?.trim() || "";
  if (twentyBase) {
    const r = await probeHttp(DATA_PLATFORM_ID, DATA_PLATFORM_LABEL, twentyBase);
    return { ...r, detail: r.detail ? `http: ${r.detail}` : "http OK" };
  }
  return {
    id: DATA_PLATFORM_ID,
    label: DATA_PLATFORM_LABEL,
    status: "skipped",
    detail: "set CRM_DB_* or TWENTY_CRM_URL",
  };
}

/**
 * GET /api/system-status — lightweight reachability checks (server-side only).
 */
export async function GET() {
  const siteArticles = process.env.SITE_API_URL?.trim() || "https://strattegys.com/api/articles";
  let siteOrigin = "https://strattegys.com";
  try {
    siteOrigin = new URL(siteArticles).origin;
  } catch {
    /* keep default */
  }

  const [dataPlatform, site] = await Promise.all([
    probeDataPlatform(),
    probeHttp("site", "Site", siteOrigin, "/"),
  ]);

  const hasInworldKey = !!process.env.INWORLD_TTS_KEY?.trim();
  const inworldTts: ProbeResult = {
    id: "inworld_tts",
    label: "Inworld TTS",
    status: hasInworldKey ? "ok" : "skipped",
    detail: hasInworldKey
      ? `voice ${process.env.INWORLD_VOICE_ID?.trim() || "default"}`
      : "add INWORLD_TTS_KEY to web/.env.local",
  };

  const services: ProbeResult[] = [
    { id: "web", label: "Command Central", status: "ok", ms: 0 },
    dataPlatform,
    site,
    inworldTts,
  ];

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    services,
  });
}
