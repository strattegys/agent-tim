import { NextResponse } from "next/server";
import { Client } from "pg";
import { getAllAgentSpecs } from "@/lib/agent-registry";
import { CRM_WORKSPACE_SCHEMA } from "@/lib/db";
import { normalizeUnipileDsn } from "@/lib/unipile-profile";

const PROBE_MS = 4000;

type ProbeStatus = "ok" | "down" | "skipped";

interface ProbeResult {
  id: string;
  label: string;
  status: ProbeStatus;
  ms?: number;
  detail?: string;
}

export interface SystemStatusAlert {
  id: string;
  severity: "error" | "warn" | "info";
  title: string;
  message: string;
}

/** Agents with spoken replies (Inworld voiceId from registry, e.g. Suzi → Olivia). */
function agentsWithTtsVoice() {
  return getAllAgentSpecs().filter((s) => s.ttsVoice?.trim());
}

function ttsVoiceRegistrySummary(): string {
  return agentsWithTtsVoice()
    .map((s) => `${s.name}=${s.ttsVoice}`)
    .join(", ");
}

function buildSystemAlerts(): SystemStatusAlert[] {
  const alerts: SystemStatusAlert[] = [];
  const voiced = agentsWithTtsVoice();
  const names = voiced.map((a) => a.name).join(", ");
  const hasInworld = !!process.env.INWORLD_TTS_KEY?.trim();
  const hasGemini = !!process.env.GEMINI_API_KEY?.trim();

  const voiceMap = ttsVoiceRegistrySummary();

  if (voiced.length > 0 && !hasInworld) {
    alerts.push({
      id: "inworld_tts_key",
      severity: "warn",
      title: "Voice (Inworld) not configured",
      message: `${names} use read-aloud (registry: ${voiceMap}). Set INWORLD_TTS_KEY in web/.env.local — same value as Rainbow Bot (PROJECT-SERVER/rainbow). On production, that file lives on the droplet under the repo (e.g. /opt/agent-tim/web/.env.local); restart the web container after editing.`,
    });
  }

  if (voiced.length > 0 && hasInworld && !hasGemini) {
    alerts.push({
      id: "tts_summarize_gemini",
      severity: "info",
      title: "Long messages: TTS summarization",
      message:
        "GEMINI_API_KEY is unset. Short replies still speak; very long replies use a simple truncation instead of Gemini summarization before TTS.",
    });
  }

  return alerts;
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
 * Postgres is what Kanban / human-tasks / packages use. If CRM_DB_PASSWORD is unset,
 * we fall back to probing TWENTY_CRM_URL (optional HTTP check when that env is set).
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
    // CRM tables live in workspace schema, not default search_path (public).
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = '_workflow_item'
      ) AS ok`,
      [CRM_WORKSPACE_SCHEMA]
    );
    const ms = Date.now() - t0;
    await client.end();
    if (!rows[0]?.ok) {
      return {
        id: DATA_PLATFORM_ID,
        label: DATA_PLATFORM_LABEL,
        status: "down",
        ms,
        detail:
          "schema incomplete (no _workflow_item) — run web/scripts/migrate-workflows.sql on this CRM DB",
      };
    }
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
    if (/ECONNREFUSED/i.test(msg)) {
      const portHint =
        process.env.CRM_DB_PORT && process.env.CRM_DB_PORT !== "5432"
          ? `port ${process.env.CRM_DB_PORT}`
          : "5432";
      detail = `${detail.slice(0, 72)} → start Postgres/SSH tunnel; local dev: CRM_DB_HOST=127.0.0.1 + scripts/crm-db-tunnel (.ps1/.sh) (${portHint})`.slice(
        0,
        160
      );
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

/** Unipile API — validates key + reachability (GET /accounts). */
async function probeUnipile(): Promise<ProbeResult> {
  const id = "unipile";
  const label = "Unipile (LinkedIn)";
  const apiKey = process.env.UNIPILE_API_KEY?.trim();
  const dsn = normalizeUnipileDsn(process.env.UNIPILE_DSN);
  const accountId = process.env.UNIPILE_ACCOUNT_ID?.trim();

  if (!apiKey || !dsn) {
    return {
      id,
      label,
      status: "skipped",
      detail: "set UNIPILE_API_KEY + UNIPILE_DSN",
    };
  }

  const url = `https://${dsn}/api/v1/accounts`;
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ac.signal,
      cache: "no-store",
      headers: {
        "X-API-KEY": apiKey,
        accept: "application/json",
      },
    });
    clearTimeout(timer);
    const ms = Date.now() - t0;

    if (res.ok) {
      let detail = accountId ? `acct ${accountId.slice(0, 8)}…` : "API OK";
      try {
        const data = (await res.json()) as unknown;
        const list = Array.isArray(data)
          ? data
          : data &&
              typeof data === "object" &&
              Array.isArray((data as { items?: unknown[] }).items)
            ? (data as { items: unknown[] }).items
            : null;
        if (list) {
          const linkedin = list.filter(
            (a: unknown) =>
              a &&
              typeof a === "object" &&
              String((a as { type?: string }).type || "").toUpperCase().includes("LINKEDIN")
          );
          detail =
            linkedin.length > 0
              ? `${linkedin.length} LinkedIn account(s)`
              : `${list.length} account(s)`;
        }
      } catch {
        /* keep default */
      }
      return { id, label, status: "ok", ms, detail };
    }

    if (res.status === 401 || res.status === 403) {
      const hint = await res.text().catch(() => "");
      return {
        id,
        label,
        status: "down",
        ms,
        detail: `auth failed (${res.status})${hint ? ` ${hint.slice(0, 40)}` : ""}`,
      };
    }

    return {
      id,
      label,
      status: "down",
      ms,
      detail: `HTTP ${res.status}`,
    };
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id,
      label,
      status: "down",
      detail: msg.includes("abort") ? "timeout" : msg.slice(0, 56),
    };
  }
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

  const [dataPlatform, site, unipile] = await Promise.all([
    probeDataPlatform(),
    probeHttp("site", "Site", siteOrigin, "/"),
    probeUnipile(),
  ]);

  const hasInworldKey = !!process.env.INWORLD_TTS_KEY?.trim();
  const registryVoices = ttsVoiceRegistrySummary();
  const envVoice = process.env.INWORLD_VOICE_ID?.trim();
  const inworldTts: ProbeResult = {
    id: "inworld_tts",
    label: "Inworld TTS",
    status: hasInworldKey ? "ok" : "down",
    detail: hasInworldKey
      ? [
          registryVoices ? `voices ${registryVoices}` : null,
          envVoice ? `INWORLD_VOICE_ID=${envVoice}` : "per-agent voice from registry (Suzi=Olivia, Tim=Timothy)",
        ]
          .filter(Boolean)
          .join(" · ")
      : [
          "set INWORLD_TTS_KEY in web/.env.local (prod: on server, then docker compose up -d)",
          registryVoices ? `registry ${registryVoices}` : "Suzi=Olivia, Tim=Timothy",
        ]
          .join(" · "),
  };

  const services: ProbeResult[] = [
    { id: "web", label: "Command Central", status: "ok", ms: 0 },
    dataPlatform,
    site,
    unipile,
    inworldTts,
  ];

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    services,
    alerts: buildSystemAlerts(),
  });
}
