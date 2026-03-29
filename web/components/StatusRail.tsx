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

interface StatusRailProps {
  agents: AgentConfig[];
  /** When provided, rail uses parent-fed alerts and skips /api/notifications polling. */
  sharedNotifications?: DashboardNotification[];
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

export default function StatusRail({
  agents,
  sharedNotifications,
}: StatusRailProps) {
  const [services, setServices] = useState<ServiceRow[] | null>(null);
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
    fetch("/api/system-status", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.services)) setServices(data.services);
        else setServices([]);
        if (Array.isArray(data.alerts)) setSystemNotices(data.alerts);
        else setSystemNotices([]);
      })
      .catch(() => {
        setServices([]);
        setSystemNotices([]);
      });
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
    // Service probes are slow; 90s is enough when chat/tasks refresh via dashboard-sync.
    const i = setInterval(fetchStatus, 90000);
    return () => clearInterval(i);
  }, [fetchStatus]);

  useEffect(() => {
    fetchAgentOps();
    const i = setInterval(fetchAgentOps, 60000);
    return () => clearInterval(i);
  }, [fetchAgentOps]);

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

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
      aria-label="System monitor"
    >
      <div className="h-11 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3.5 min-w-0">
        <p
          className="text-xs font-medium text-[var(--text-tertiary)] leading-tight uppercase tracking-wide truncate min-w-0"
          title="System monitor"
        >
          System monitor
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 p-2">
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

        <section>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
            Agents
          </div>
          <p className="text-[8px] text-[var(--text-tertiary)] leading-snug mb-1.5 font-mono">
            Per agent: eye · heartbeat · memory · knowledge — work items: bell in the left bar
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
                      title="Knowledge & external RAG (Marni) — in development"
                    >
                      <KnowledgeRagIcon size={14} stroke="#6b7280" />
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {systemNotices.length > 0 && (
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
        )}

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
      </div>
    </div>
  );
}
