"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentConfig } from "@/lib/agent-frontend";
import type { DashboardNotification } from "@/lib/dashboard-sync-types";
import type { StatusRailAgentRow, StatusRailHeartbeat, StatusRailMemory } from "@/lib/status-rail-agents-types";
import { AgentsOverviewEyeIcon } from "@/components/icons/AgentsOverviewEyeIcon";
import { HeartbeatActivityIcon } from "@/components/icons/HeartbeatActivityIcon";
import { KnowledgeRagIcon } from "@/components/icons/KnowledgeRagIcon";
import { MemoryBrainIcon } from "@/components/icons/MemoryBrainIcon";
import { getAgentSpec } from "@/lib/agent-registry";
import { isKbStudioAgentId } from "@/lib/kb-studio";
import TimLabLogDock from "@/components/TimLabLogDock";
import FridayLabLogDock from "@/components/FridayLabLogDock";

const ALERT_TYPES = ["linkedin_inbound", "linkedin", "campaign", "workflow", "schedule"];

interface NotificationRow {
  type: string;
  title: string;
  message: string;
  timestamp: string;
}

interface ServiceRow {
  id: string;
  label: string;
  status: "ok" | "down" | "skipped";
  ms?: number;
  detail?: string;
}

interface SystemNotice {
  id: string;
  severity: "error" | "warn" | "info";
  title: string;
  message: string;
}

function serviceSubline(s: ServiceRow): string {
  if (s.status === "down") return s.detail || "unreachable";
  if (s.status === "skipped") return s.detail || "not configured";
  const parts: string[] = [];
  if (s.detail?.trim()) parts.push(s.detail.trim());
  if (s.ms != null && s.ms > 0) parts.push(`${s.ms}ms`);
  return parts.length > 0 ? parts.join(" · ") : "OK";
}

const CORE_SYSTEM_IDS = new Set(["web", "data_platform"]);
/** Strattegys site + Rainbow and other project-server HTTP probes (`site` = legacy id). */
const WEBSITE_PROJECT_IDS = new Set(["strattegys", "site", "rainbow"]);
const MAX_SERVICE_LINES = 5;

function aggregateGroupStatus(rows: ServiceRow[]): ServiceRow["status"] {
  if (rows.length === 0) return "skipped";
  if (rows.some((r) => r.status === "down")) return "down";
  if (rows.every((r) => r.status === "skipped")) return "skipped";
  return "ok";
}

/** One line per probe (Unipile, Inworld, …) for the Services block. */
function linesFromRows(rows: ServiceRow[]): string {
  if (rows.length === 0) return "—";
  return rows.map((r) => `${r.label} — ${serviceSubline(r)}`).join("\n");
}

function pickServiceRows(services: ServiceRow[]): ServiceRow[] {
  const excluded = new Set([...CORE_SYSTEM_IDS, ...WEBSITE_PROJECT_IDS]);
  const candidates = services.filter((s) => !excluded.has(s.id));
  const preferredOrder = ["unipile", "inworld_tts"];
  const out: ServiceRow[] = [];
  for (const id of preferredOrder) {
    const r = candidates.find((c) => c.id === id);
    if (r) out.push(r);
  }
  for (const c of candidates) {
    if (!out.some((o) => o.id === c.id)) out.push(c);
  }
  return out.slice(0, MAX_SERVICE_LINES);
}

/** Command Central, Data Platform, Website-Projects (project server), Services (Unipile, Inworld, …). */
function buildConsolidatedSystemRows(services: ServiceRow[] | null): ServiceRow[] {
  if (services === null) {
    return [
      { id: "web", label: "Command Central", status: "ok", ms: 0 },
      {
        id: "data_platform",
        label: "Data Platform",
        status: "skipped",
        detail: "Loading…",
      },
      {
        id: "website_projects",
        label: "Website-Projects",
        status: "skipped",
        detail: "Loading…",
      },
      {
        id: "integrations_services",
        label: "Services",
        status: "skipped",
        detail: "Loading…",
      },
    ];
  }

  const find = (id: string) => services.find((s) => s.id === id);

  const commandCentral =
    find("web") ??
    ({ id: "web", label: "Command Central", status: "ok" as const, ms: 0 } satisfies ServiceRow);

  const dataPlatform =
    find("data_platform") ??
    ({
      id: "data_platform",
      label: "Data Platform",
      status: "skipped" as const,
      detail: "not reported",
    } satisfies ServiceRow);

  const rawStrattegys = find("strattegys") ?? find("site");
  const strattegysRow: ServiceRow = rawStrattegys
    ? { ...rawStrattegys, id: "strattegys", label: "Strattegys" }
    : {
        id: "strattegys",
        label: "Strattegys",
        status: "skipped",
        detail: "not probed",
      };

  const rainbowRow =
    find("rainbow") ??
    ({
      id: "rainbow",
      label: "Rainbow",
      status: "skipped" as const,
      detail: "set PROJECT_SERVER_RAINBOW_URL to probe",
    } satisfies ServiceRow);

  const websiteProjectParts = [strattegysRow, rainbowRow];
  const websiteProjects: ServiceRow = {
    id: "website_projects",
    label: "Website-Projects",
    status: aggregateGroupStatus(websiteProjectParts),
    detail: linesFromRows(websiteProjectParts),
  };

  const serviceParts = pickServiceRows(services);
  const servicesRow: ServiceRow = {
    id: "integrations_services",
    label: "Services",
    status: aggregateGroupStatus(serviceParts),
    detail: linesFromRows(serviceParts),
  };

  return [commandCentral, dataPlatform, websiteProjects, servicesRow];
}

export type StatusRailLabMode = "off" | "tim" | "friday" | "devNeutral";

interface StatusRailProps {
  agents: AgentConfig[];
  /** When provided, rail uses parent-fed alerts and skips /api/notifications polling. */
  sharedNotifications?: DashboardNotification[];
  /**
   * Desktop lab layouts: wider right column, no per-agent heartbeat poll.
   * `tim` — Unipile + Groq log dock. `friday` — Data Platform + notices/alerts (CRM workflow focus).
   * `devNeutral` — compact dev chrome without Tim/Friday log docks (other agents).
   */
  labMode?: StatusRailLabMode;
  /** Shown in the rail header when `labMode` is `devNeutral` (e.g. active agent display name). */
  devLayoutAgentLabel?: string | null;
}

function formatAlertTime(ts: string) {
  const d = new Date(ts);
  const now = Date.now();
  const diffM = Math.floor((now - d.getTime()) / 60000);
  if (diffM < 1) return "now";
  if (diffM < 60) return `${diffM}m`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusDotClass(s: ServiceRow["status"]) {
  if (s === "ok") return "bg-[#1D9E75]";
  if (s === "down") return "bg-red-500";
  return "bg-[var(--text-tertiary)]";
}

function noticeSeverityClass(sev: SystemNotice["severity"]) {
  if (sev === "error") return "border-red-500/40 bg-red-500/10 text-red-200";
  if (sev === "warn") return "border-[#F59E0B]/40 bg-[#F59E0B]/10 text-[var(--text-primary)]";
  return "border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]";
}

function heartbeatStroke(s: StatusRailHeartbeat): string {
  if (s === "ok") return "#1D9E75";
  if (s === "warn") return "#F59E0B";
  if (s === "error") return "#E54D2E";
  if (s === "skipped") return "#6b7280";
  return "#6b7280";
}

function memoryStroke(s: StatusRailMemory): string {
  if (s === "ok") return "#1D9E75";
  if (s === "warn") return "#F59E0B";
  if (s === "error") return "#E54D2E";
  return "#6b7280";
}

/** Knowledge Studio (Marni/Tim): green when Data Platform OK; warn/error when DB unreachable. */
function knowledgeRailStatus(
  agentId: string,
  services: ServiceRow[] | null
): { stroke: string; title: string } {
  if (!isKbStudioAgentId(agentId)) {
    return {
      stroke: "#6b7280",
      title: "Knowledge Studio not enabled for this agent",
    };
  }
  if (services === null) {
    return {
      stroke: "#6b7280",
      title: "Knowledge Studio: loading system status…",
    };
  }
  const dp = services.find((s) => s.id === "data_platform");
  if (dp?.status === "ok") {
    const label = agentId === "tim" ? "Tim" : "Marni";
    return {
      stroke: "#1D9E75",
      title: `Knowledge Studio (${label}) — Data Platform OK; topics & RAG corpus available`,
    };
  }
  if (dp?.status === "skipped") {
    return {
      stroke: "#F59E0B",
      title: `Knowledge Studio: Data Platform not configured or unreachable — ${dp.detail ?? "check CRM_DB_* and tunnel"}`,
    };
  }
  if (dp?.status === "down") {
    return {
      stroke: "#E54D2E",
      title: `Knowledge Studio: Data Platform down — ${dp.detail ?? "use Refresh Data Platform or reconnect"}`,
    };
  }
  return {
    stroke: "#6b7280",
    title: "Knowledge Studio: Data Platform status unknown",
  };
}

/** Per-agent “functioning?”: online + heartbeat (eye icon). */
function perAgentOverviewStroke(
  a: AgentConfig,
  agentOps: Record<string, StatusRailAgentRow> | null
): string {
  if (!agentOps) return "#6b7280";
  const hb = agentOps[a.id]?.heartbeat ?? "none";
  if (hb === "error") return "#E54D2E";
  if (!a.online || hb === "warn") return "#F59E0B";
  return "#1D9E75";
}

function perAgentOverviewTitle(a: AgentConfig, row: StatusRailAgentRow | undefined): string {
  const online = a.online ? "Online" : "Offline";
  if (!row) return `${a.name}: ${online} · loading heartbeat…`;
  return `${a.name}: ${online} · heartbeat ${row.heartbeat} (${row.heartbeatDetail})`;
}

function StatusRailNoticesAndAlerts({
  systemNotices,
  alerts,
}: {
  systemNotices: SystemNotice[];
  alerts: NotificationRow[];
}) {
  return (
    <>
      {systemNotices.length > 0 ? (
        <section>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
            Notices
          </div>
          <ul className="space-y-2">
            {systemNotices.map((n) => (
              <li
                key={n.id}
                className={`rounded-md border px-2 py-1.5 text-[10px] leading-snug ${noticeSeverityClass(n.severity)}`}
              >
                <div className="font-semibold text-[var(--text-primary)]">{n.title}</div>
                <div className="text-[var(--text-secondary)] mt-0.5">{n.message}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="min-h-0 flex-1 flex flex-col">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
          Alerts
        </div>
        {alerts.length === 0 ? (
          <p className="font-mono text-[10px] text-[var(--text-tertiary)]">No alerts</p>
        ) : (
          <ul className="font-mono text-[10px] space-y-2">
            {alerts.map((n, i) => (
              <li key={`${n.timestamp}-${i}`} className="border-b border-[var(--border-color)] pb-2 last:border-0 last:pb-0">
                <div className="flex justify-between gap-1 text-[var(--text-tertiary)]">
                  <span className="truncate uppercase text-[9px]">{n.type.replace(/_/g, " ")}</span>
                  <span className="shrink-0">{formatAlertTime(n.timestamp)}</span>
                </div>
                <div className="text-[var(--text-secondary)] font-medium truncate mt-0.5">{n.title}</div>
                <div className="text-[var(--text-tertiary)] line-clamp-3 mt-0.5 break-words">{n.message}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function StatusRail({
  agents,
  sharedNotifications,
  labMode = "off",
  devLayoutAgentLabel,
}: StatusRailProps) {
  const labDockActive = labMode === "tim" || labMode === "friday";
  const railTitle =
    labMode === "tim"
      ? "Tim lab"
      : labMode === "friday"
        ? "Friday lab"
        : labMode === "devNeutral"
          ? devLayoutAgentLabel
            ? `Dev layout · ${devLayoutAgentLabel}`
            : "Dev layout"
          : "System monitor";
  const [services, setServices] = useState<ServiceRow[] | null>(null);
  /** Set when /api/system-status is non-OK, times out, or cannot be parsed (session, server crash, etc.). */
  const [systemStatusFetchHint, setSystemStatusFetchHint] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<NotificationRow[]>([]);
  const [systemNotices, setSystemNotices] = useState<SystemNotice[]>([]);
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const [reconnectNote, setReconnectNote] = useState<string | null>(null);
  const [agentOps, setAgentOps] = useState<Record<string, StatusRailAgentRow> | null>(null);
  const teamAgents = agents.filter((a) => a.category !== "Toys");

  const consolidatedSystemRows = useMemo(
    () => buildConsolidatedSystemRows(services),
    [services]
  );

  const dataPlatformDown = useMemo(() => {
    if (!services) return false;
    return services.some((s) => s.id === "data_platform" && s.status === "down");
  }, [services]);

  const fetchAgentOps = useCallback(() => {
    fetch("/api/status-rail-agents", { credentials: "include" })
      .then((r) => r.json())
      .then((data: { agents?: Record<string, StatusRailAgentRow> }) => {
        if (data.agents && typeof data.agents === "object") setAgentOps(data.agents);
        else setAgentOps({});
      })
      .catch(() => setAgentOps({}));
  }, []);

  const fetchStatus = useCallback(() => {
    const ac = new AbortController();
    const tid = window.setTimeout(() => ac.abort(), 22_000);
    fetch("/api/system-status", { credentials: "include", signal: ac.signal })
      .then(async (r) => {
        let data: { services?: unknown; alerts?: unknown; error?: string } = {};
        try {
          data = (await r.json()) as typeof data;
        } catch {
          /* non-JSON */
        }

        if (!r.ok) {
          const errText =
            typeof data.error === "string"
              ? data.error
              : r.status === 401
                ? "Unauthorized"
                : `HTTP ${r.status}`;
          setSystemStatusFetchHint(
            r.status === 401
              ? "Session expired or cookies blocked — sign out and sign in again (same host as NEXTAUTH_URL)."
              : `/api/system-status failed (${errText}). Check the terminal running next dev or Docker web logs.`
          );
          setServices([
            { id: "web", label: "Command Central", status: "ok", ms: 0 },
            {
              id: "data_platform",
              label: "Data Platform",
              status: "skipped",
              detail:
                r.status === 401
                  ? "Not authenticated — status API needs your login session"
                  : `API ${r.status}: ${errText}`,
            },
          ]);
          if (Array.isArray(data.alerts)) setSystemNotices(data.alerts as SystemNotice[]);
          else setSystemNotices([]);
          return;
        }

        setSystemStatusFetchHint(null);
        if (Array.isArray(data.services)) setServices(data.services as ServiceRow[]);
        else setServices([]);
        if (Array.isArray(data.alerts)) setSystemNotices(data.alerts as SystemNotice[]);
        else setSystemNotices([]);
      })
      .catch((e) => {
        const aborted = e instanceof DOMException && e.name === "AbortError";
        setSystemStatusFetchHint(
          aborted
            ? "Status check timed out (22s). Postgres or outbound HTTP may be slow; try Refresh Data Platform or restart dev."
            : "Could not reach /api/system-status — is the dev server running?"
        );
        setServices([]);
        setSystemNotices([]);
      })
      .finally(() => clearTimeout(tid));
  }, []);

  const fetchNotifications = useCallback(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((data) => {
        const list = (data.notifications || []) as NotificationRow[];
        const filtered = list.filter((n) => ALERT_TYPES.includes(n.type)).slice(0, 12);
        setAlerts(filtered);
      })
      .catch(() => {});
  }, []);

  const useSharedAlerts = sharedNotifications !== undefined;

  useEffect(() => {
    if (useSharedAlerts) {
      const list = (sharedNotifications || []) as NotificationRow[];
      const filtered = list.filter((n) => ALERT_TYPES.includes(n.type)).slice(0, 12);
      setAlerts(filtered);
      return;
    }
    fetchNotifications();
    const i = setInterval(fetchNotifications, 30000);
    return () => clearInterval(i);
  }, [useSharedAlerts, sharedNotifications, fetchNotifications]);

  useEffect(() => {
    fetchStatus();
    // Poll faster while Data platform is down so the rail recovers soon after the host bridge starts.
    const intervalMs = dataPlatformDown ? 12000 : 90000;
    const i = setInterval(fetchStatus, intervalMs);
    return () => clearInterval(i);
  }, [fetchStatus, dataPlatformDown]);

  /** Localhost dev: pool reset + probe every ~20s while Data platform is down (picks up bridge without manual Refresh). */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname;
    if (host !== "localhost" && host !== "127.0.0.1") return;
    if (!dataPlatformDown) return;

    const tick = () => {
      fetch("/api/crm/reconnect-db", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      }).finally(() => fetchStatus());
    };
    const t0 = window.setTimeout(tick, 2500);
    const i = window.setInterval(tick, 20000);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(i);
    };
  }, [dataPlatformDown, fetchStatus]);

  useEffect(() => {
    if (labDockActive) return;
    fetchAgentOps();
    const i = setInterval(fetchAgentOps, 60000);
    return () => clearInterval(i);
  }, [labDockActive, fetchAgentOps]);

  const onReconnectDataPlatform = useCallback(async () => {
    setReconnectBusy(true);
    setReconnectNote(null);
    try {
      const r = await fetch("/api/crm/reconnect-db", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await r.json()) as { message?: string; error?: string };
      const text = data.message || data.error || (r.ok ? "Done." : "Request failed.");
      setReconnectNote(text);
      fetchStatus();
      fetchAgentOps();
    } catch {
      setReconnectNote("Request failed — try again.");
      fetchStatus();
      fetchAgentOps();
    } finally {
      setReconnectBusy(false);
    }
  }, [fetchStatus, fetchAgentOps]);

  const statusFetchBanner =
    systemStatusFetchHint != null && systemStatusFetchHint !== "" ? (
      <p
        className="mb-2 rounded border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[9px] leading-snug text-amber-100/95"
        role="status"
      >
        {systemStatusFetchHint}
      </p>
    ) : null;

  const systemStatusSection = (
    <section>
      <ul className="font-mono text-[10px] space-y-1">
        {consolidatedSystemRows.map((s) => (
          <li key={s.id} className="flex items-start gap-1.5 min-w-0" title={s.detail}>
            <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${statusDotClass(s.status)}`} />
            <span className="min-w-0 flex-1">
              <span className="text-[var(--text-secondary)] block truncate">{s.label}</span>
              <span className="text-[var(--text-tertiary)] break-words whitespace-pre-line leading-snug">
                {s.id === "website_projects" || s.id === "integrations_services"
                  ? s.detail
                  : serviceSubline(s)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={reconnectBusy}
        onClick={onReconnectDataPlatform}
        className="mt-2 w-full rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)] disabled:opacity-50"
        title="Clears stale CRM connection pool and probes Postgres. Docker dev: tunnel must listen on 0.0.0.0:5433 on Windows — run npm run db:reconnect from COMMAND-CENTRAL/web (this button cannot start SSH)."
      >
        {reconnectBusy ? "Checking…" : "Refresh Data Platform"}
      </button>
      {reconnectNote ? (
        <p
          className="mt-1.5 text-[9px] leading-snug text-[var(--text-tertiary)] break-words line-clamp-12"
          title={reconnectNote}
        >
          {reconnectNote}
        </p>
      ) : null}
    </section>
  );

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
      aria-label={railTitle}
    >
      <div className="h-11 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3.5 min-w-0">
        <p
          className="text-xs font-medium text-[var(--text-tertiary)] leading-tight uppercase tracking-wide truncate min-w-0"
          title={railTitle}
        >
          {railTitle}
        </p>
      </div>

      <div className="flex-1 min-h-0 flex flex-col min-w-0 overflow-hidden">
        {labMode === "tim" ? (
          <>
            <div className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
              {statusFetchBanner}
              {systemStatusSection}
            </div>
            <TimLabLogDock fillRail />
          </>
        ) : labMode === "friday" ? (
          <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
              {statusFetchBanner}
              {systemStatusSection}
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="max-h-36 shrink-0 overflow-y-auto border-b border-[var(--border-color)] p-2">
                <p className="mb-2 font-mono text-[9px] leading-snug text-[var(--text-tertiary)]">
                  Workflow traces below (Kanban moves, package activate, workflow stage, cron). Data Platform
                  above must be OK for live CRM — Refresh Data Platform if needed.
                </p>
                <StatusRailNoticesAndAlerts systemNotices={systemNotices} alerts={alerts} />
              </div>
              <FridayLabLogDock fillRail />
            </div>
          </div>
        ) : (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 p-2">
        {statusFetchBanner}
        {systemStatusSection}

        {labMode === "devNeutral" ? (
          <p className="text-[9px] leading-snug text-[var(--text-tertiary)] font-mono">
            System monitor — no agent-specific lab logs for this workspace. Use Tim or Friday with Dev
            when you need Unipile or workflow traces.
          </p>
        ) : null}

        <section>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
            Agents
          </div>
          <p className="text-[8px] text-[var(--text-tertiary)] leading-snug mb-1.5 font-mono">
            Per agent: eye · heartbeat · memory · book (Knowledge Studio — same icon as header, right of Agent info) — work: bell left
          </p>
          <ul className="font-mono text-[10px] space-y-2">
            {teamAgents.map((a) => {
              const row = agentOps?.[a.id];
              const hb: StatusRailHeartbeat = row?.heartbeat ?? "none";
              const mem: StatusRailMemory = row?.memory ?? "none";
              const hasMemoryTool = getAgentSpec(a.id).tools.includes("memory");
              const hbTitle = row
                ? `Heartbeat: ${row.heartbeatDetail}`
                : "Heartbeat: loading…";
              const memTitle = hasMemoryTool
                ? row
                  ? `Memory: ${row.memoryDetail}`
                  : "Memory: loading…"
                : "Memory tool not enabled for this agent";
              const eyeTitle = perAgentOverviewTitle(a, row);
              const kb = knowledgeRailStatus(a.id, services);
              return (
                <li key={a.id} className="flex items-center gap-1 min-w-0">
                  <span className="truncate text-[var(--text-secondary)] min-w-0 flex-1 pr-0.5">{a.name}</span>
                  <span className="shrink-0 inline-flex items-center gap-0.5" aria-label={`${a.name} status icons`}>
                    <span className="inline-flex items-center justify-center w-[18px]" title={eyeTitle}>
                      <AgentsOverviewEyeIcon
                        size={14}
                        stroke={perAgentOverviewStroke(a, agentOps)}
                      />
                    </span>
                    <span className="inline-flex items-center justify-center w-[18px]" title={hbTitle}>
                      <HeartbeatActivityIcon
                        size={14}
                        stroke={agentOps ? heartbeatStroke(hb) : "#6b7280"}
                      />
                    </span>
                    <span className="inline-flex items-center justify-center w-[18px]" title={memTitle}>
                      <MemoryBrainIcon
                        size={14}
                        stroke={
                          agentOps && hasMemoryTool ? memoryStroke(mem) : "#6b7280"
                        }
                      />
                    </span>
                    <span
                      className="inline-flex items-center justify-center w-[18px]"
                      title={kb.title}
                    >
                      <KnowledgeRagIcon size={14} stroke={kb.stroke} />
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <StatusRailNoticesAndAlerts systemNotices={systemNotices} alerts={alerts} />
        </div>
        )}
      </div>
    </div>
  );
}
