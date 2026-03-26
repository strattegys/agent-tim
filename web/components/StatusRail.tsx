"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentConfig } from "@/lib/agent-frontend";

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

interface StatusRailProps {
  agents: AgentConfig[];
  pendingTaskCount: number;
  testingTaskCount: number;
  timMessagingTaskCount?: number;
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

export default function StatusRail({
  agents,
  pendingTaskCount,
  testingTaskCount,
  timMessagingTaskCount = 0,
}: StatusRailProps) {
  const [services, setServices] = useState<ServiceRow[] | null>(null);
  const [alerts, setAlerts] = useState<NotificationRow[]>([]);
  const [systemNotices, setSystemNotices] = useState<SystemNotice[]>([]);

  const teamAgents = agents.filter((a) => a.category !== "Toys");

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

  useEffect(() => {
    fetchNotifications();
    const i = setInterval(fetchNotifications, 30000);
    return () => clearInterval(i);
  }, [fetchNotifications]);

  useEffect(() => {
    fetchStatus();
    const i = setInterval(fetchStatus, 60000);
    return () => clearInterval(i);
  }, [fetchStatus]);

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
      aria-label="System status"
    >
      <div className="shrink-0 h-11 border-b border-[var(--border-color)] px-2 flex items-center gap-1.5 min-w-0">
        <span
          className="w-1.5 h-1.5 rounded-full bg-[#1D9E75] shrink-0 animate-pulse"
          title="Polling"
        />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate min-w-0">
          Status
        </span>
        <span
          className="ml-auto shrink-0 text-[10px] font-mono text-[var(--text-tertiary)] tabular-nums"
          title="Build code"
        >
          B25D
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 p-2">
        <section>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
            Services
          </div>
          <ul className="font-mono text-[10px] space-y-1">
            {(services ?? [{ id: "web", label: "Command Central", status: "ok" as const }]).map((s) => (
              <li key={s.id} className="flex items-start gap-1.5 min-w-0" title={s.detail}>
                <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${statusDotClass(s.status)}`} />
                <span className="min-w-0 flex-1">
                  <span className="text-[var(--text-secondary)] block truncate">{s.label}</span>
                  <span className="text-[var(--text-tertiary)] break-words whitespace-normal leading-snug">
                    {serviceSubline(s)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
            Agents
          </div>
          <ul className="font-mono text-[10px] space-y-1">
            {teamAgents.map((a) => {
              const showFridayTaskCount = a.id === "friday" && pendingTaskCount > 0;
              const warnPenny = a.id === "penny" && testingTaskCount > 0;
              const warnTim = a.id === "tim" && timMessagingTaskCount > 0;
              return (
                <li key={a.id} className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      background: !a.online ? "#555" : warnPenny || warnTim ? "#F59E0B" : "#1D9E75",
                    }}
                  />
                  <span className="truncate text-[var(--text-secondary)]">{a.name}</span>
                  {showFridayTaskCount && (
                    <span className="text-[var(--text-tertiary)] shrink-0 tabular-nums" title="Active-package human tasks (see Friday → Human tasks)">
                      {pendingTaskCount}
                    </span>
                  )}
                  {warnPenny && (
                    <span className="text-[#F59E0B] shrink-0" title="Pending approval">
                      {testingTaskCount}
                    </span>
                  )}
                  {warnTim && (
                    <span className="text-[#F59E0B] shrink-0" title="Tim work queue (open tasks)">
                      {timMessagingTaskCount}
                    </span>
                  )}
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
