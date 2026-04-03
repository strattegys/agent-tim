import { NextResponse } from "next/server";
import { Client } from "pg";
import { getAllAgentSpecs } from "@/lib/agent-registry";
import {
  CRM_WORKSPACE_SCHEMA,
  crmResolvedHostPort,
  crmTailscaleDirectRefusedHint,
  getCrmDataPlatformConnectionLabel,
} from "@/lib/db";
import { normalizeUnipileDsn } from "@/lib/unipile-profile";
import { isLinkedInAutomationDisabled } from "@/lib/linkedin-automation-gate";
import { getPerfSnapshot, recordServiceLatency, recordUiLatency } from "@/lib/perf-metrics";

export const runtime = "nodejs";

const PROBE_MS = 4000;

/** Hard cap so the route always responds even if `pg` connect/query hangs past `connectionTimeoutMillis`. */
function dataPlatformProbeBudgetMs(): number {
  return crmPostgresProbeTimeoutMs() + 4000;
}

function raceTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeout());
    }, ms);
    p.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(v);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(onTimeout());
      }
    );
  });
}

/** Postgres probe can be slower than HTTP (SSH tunnel to 127.0.0.1:5433, Tailscale, etc.). */
function crmPostgresProbeTimeoutMs(): number {
  const raw = process.env.CRM_DB_PROBE_TIMEOUT_MS;
  if (raw != null && raw.trim() !== "") {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1000) return Math.min(n, 120_000);
  }
  return 12_000;
}

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
  const hasGroq = !!process.env.GROQ_API_KEY?.trim();

  const voiceMap = ttsVoiceRegistrySummary();

  if (voiced.length > 0 && !hasInworld) {
    alerts.push({
      id: "inworld_tts_key",
      severity: "warn",
      title: "Voice (Inworld) not configured",
      message: `${names} use read-aloud (registry: ${voiceMap}). Set INWORLD_TTS_KEY in web/.env.local — same value as Rainbow Bot (PROJECT-SERVER/rainbow). On production, that file lives on the droplet under the repo (e.g. /opt/agent-tim/web/.env.local); restart the web container after editing.`,
    });
  }

  if (voiced.length > 0 && hasInworld && !hasGroq) {
    alerts.push({
      id: "tts_summarize_groq",
      severity: "info",
      title: "Long messages: TTS summarization",
      message:
        "GROQ_API_KEY is unset. Short replies still speak; very long replies use a simple truncation instead of Groq summarization before TTS.",
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
    recordServiceLatency(ms, res.ok || (res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403);
    if (res.ok || (res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403) {
      return { id, label, status: "ok", ms };
    }
    return { id, label, status: "down", ms, detail: `HTTP ${res.status}` };
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    recordServiceLatency(Date.now() - t0, false);
    return { id, label, status: "down", detail: msg.includes("abort") ? "timeout" : msg.slice(0, 48) };
  }
}

const DATA_PLATFORM_ID = "data_platform";
const DATA_PLATFORM_LABEL = "Data Platform";

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

  const { host: dbHost, port: dbPort } = crmResolvedHostPort();
  const target = `${dbHost}:${dbPort}`;
  const tierHint = getCrmDataPlatformConnectionLabel();

  const pgProbeMs = crmPostgresProbeTimeoutMs();
  const client = new Client({
    host: dbHost,
    port: dbPort,
    database: process.env.CRM_DB_NAME || "default",
    user: process.env.CRM_DB_USER || "postgres",
    password,
    connectionTimeoutMillis: pgProbeMs,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
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
      recordServiceLatency(ms, false);
      return {
        id: DATA_PLATFORM_ID,
        label: DATA_PLATFORM_LABEL,
        status: "down",
        ms,
        detail:
          `schema incomplete (no _workflow_item) — run web/scripts/migrate-workflows.sql on this CRM DB · ${tierHint}`,
      };
    }
    recordServiceLatency(ms, true);
    return {
      id: DATA_PLATFORM_ID,
      label: DATA_PLATFORM_LABEL,
      status: "ok",
      ms,
      detail: `postgres · ${tierHint}`,
    };
  } catch (e) {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    const msg = e instanceof Error ? e.message : String(e);
    let detail = `${msg.slice(0, 72)} · ${target}`.slice(0, 96);
    if (/timeout expired/i.test(msg)) {
      detail =
        `Postgres connect timed out (${pgProbeMs}ms) · ${target}. Tunnel down, slow SSH, or wrong host/port — or set CRM_DB_PROBE_TIMEOUT_MS=20000 in web/.env.local.`.slice(
          0,
          220
        );
    } else if (/ECONNRESET|terminated unexpectedly|Connection closed/i.test(msg)) {
      detail =
        `TCP/Postgres dropped (${msg.slice(0, 48)}) · ${target}. Often right after crm-db restarts on the server (deploy/expose). Wait ~30s, run cd web && npm run db:reconnect:bridge, then Refresh.`.slice(
          0,
          220
        );
    } else if (/ECONNREFUSED/i.test(msg)) {
      const tsHint = crmTailscaleDirectRefusedHint(dbHost);
      if (tsHint) {
        detail = `${msg.slice(0, 48)} · ${target} — ${tsHint}`.slice(0, 280);
      } else {
        const portHint =
          process.env.CRM_DB_PORT && process.env.CRM_DB_PORT !== "5432"
            ? `port ${process.env.CRM_DB_PORT}`
            : "5432";
        const dockerTunnel =
          dbHost === "host.docker.internal" || dbHost.endsWith(".docker.internal")
            ? " From Docker, tunnel must bind 0.0.0.0 (default in crm-db-tunnel.ps1/.sh), not 127.0.0.1 only."
            : "";
        detail = `${detail.slice(0, 88)} → start SSH tunnel to droplet :5432 (${portHint}).${dockerTunnel}`.slice(
          0,
          220
        );
      }
    }
    recordServiceLatency(Date.now() - t0, false);
    return {
      id: DATA_PLATFORM_ID,
      label: DATA_PLATFORM_LABEL,
      status: "down",
      detail: `${detail} · ${tierHint}`,
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
  if (isLinkedInAutomationDisabled()) {
    return {
      id,
      label,
      status: "skipped",
      detail: "LINKEDIN_AUTOMATION_DISABLED — webhooks + LinkedIn crons paused",
    };
  }
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
    recordServiceLatency(ms, res.ok);

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
    recordServiceLatency(Date.now() - t0, false);
    return {
      id,
      label,
      status: "down",
      detail: msg.includes("abort") ? "timeout" : msg.slice(0, 56),
    };
  }
}

/**
 * Website-Projects: Strattegys (SITE_API_URL origin) + optional Rainbow (PROJECT_SERVER_RAINBOW_URL).
 */
async function computeSystemStatusPayload(): Promise<{
  checkedAt: string;
  services: ProbeResult[];
  alerts: SystemStatusAlert[];
  perf: ReturnType<typeof getPerfSnapshot>;
}> {
  const siteArticles = process.env.SITE_API_URL?.trim() || "https://strattegys.com/api/articles";
  let siteOrigin = "https://strattegys.com";
  try {
    siteOrigin = new URL(siteArticles).origin;
  } catch {
    /* keep default */
  }

  /** Public Rainbow origin on the project server (optional; skipped if unset). */
  const rainbowBase = process.env.PROJECT_SERVER_RAINBOW_URL?.trim() || "";

  const budget = dataPlatformProbeBudgetMs();
  const [dataPlatform, strattegys, rainbow, unipile] = await Promise.all([
    raceTimeout(probeDataPlatform(), budget, () => ({
      id: DATA_PLATFORM_ID,
      label: DATA_PLATFORM_LABEL,
      status: "down" as const,
      detail: `probe stalled (${budget}ms) — CRM unreachable, tunnel stopped, or raise CRM_DB_PROBE_TIMEOUT_MS`,
    })),
    probeHttp("strattegys", "Strattegys", siteOrigin, "/"),
    probeHttp("rainbow", "Rainbow", rainbowBase || undefined, "/"),
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
          envVoice ? `INWORLD_VOICE_ID=${envVoice}` : "per-agent voice from registry (see agent-registry ttsVoice)",
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
    strattegys,
    rainbow,
    unipile,
    inworldTts,
  ];

  return {
    checkedAt: new Date().toISOString(),
    services,
    alerts: buildSystemAlerts(),
    perf: getPerfSnapshot(),
  };
}

function degradedPayload(message: string): {
  checkedAt: string;
  services: ProbeResult[];
  alerts: SystemStatusAlert[];
  perf: ReturnType<typeof getPerfSnapshot>;
} {
  let alerts: SystemStatusAlert[] = [];
  try {
    alerts = buildSystemAlerts();
  } catch {
    /* ignore */
  }
  return {
    checkedAt: new Date().toISOString(),
    alerts,
    perf: getPerfSnapshot(),
    services: [
      { id: "web", label: "Command Central", status: "ok", ms: 0 },
      {
        id: DATA_PLATFORM_ID,
        label: DATA_PLATFORM_LABEL,
        status: "down",
        detail: message.slice(0, 220),
      },
      {
        id: "strattegys",
        label: "Strattegys",
        status: "skipped",
        detail: "probe skipped after status handler error",
      },
      {
        id: "rainbow",
        label: "Rainbow",
        status: "skipped",
        detail: "not probed",
      },
      {
        id: "unipile",
        label: "Unipile (LinkedIn)",
        status: "skipped",
        detail: "not probed",
      },
      {
        id: "inworld_tts",
        label: "Inworld TTS",
        status: "skipped",
        detail: "not probed",
      },
    ],
  };
}

/** GET /api/system-status — lightweight reachability checks (server-side only). */
export async function GET() {
  const t0 = Date.now();
  try {
    const payload = await computeSystemStatusPayload();
    const ms = Date.now() - t0;
    recordUiLatency(ms, true);
    console.info(`[perf][api/system-status] ${ms}ms`);
    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/system-status] uncaught", e);
    const ms = Date.now() - t0;
    recordUiLatency(ms, false);
    console.warn(`[perf][api/system-status] failed ${ms}ms :: ${msg.slice(0, 120)}`);
    return NextResponse.json(
      degradedPayload(`Status handler crashed — check web server logs: ${msg}`)
    );
  }
}
