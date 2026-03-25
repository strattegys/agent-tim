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

interface StatusRailProps {
  agents: AgentConfig[];
  pendingTaskCount: number;
  testingTaskCount: number;
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

export default function StatusRail({ agents, pendingTaskCount, testingTaskCount }: StatusRailProps) {
  const [services, setServices] = useState<ServiceRow[] | null>(null);
  const [alerts, setAlerts] = useState<NotificationRow[]>([]);

  const teamAgents = agents.filter((a) => a.category !== "Toys");

  const fetchStatus = useCallback(() => {
    fetch("/api/system-status")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.services)) setServices(data.services);
        else setServices([]);
      })
      .catch(() => setServices([]));
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
      className="hidden md:flex w-[10%] shrink-0 flex-col border-l border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
      aria-label="System status"
    >
      <div className="shrink-0 h-11 border-b border-[var(--border-color)] px-2 flex items-center gap-1.5">
        <span
          className="w-1.5 h-1.5 rounded-full bg-[#1D9E75] shrink-0 animate-pulse"
          title="Polling"
        />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate">
          Status
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
                  <span className="text-[var(--text-tertiary)]">
                    {s.status === "skipped" ? "—" : s.status === "ok" ? (s.ms != null && s.ms > 0 ? `${s.ms}ms` : "OK") : s.detail || "down"}
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
              const warnFriday = a.id === "friday" && pendingTaskCount > 0;
              const warnPenny = a.id === "penny" && testingTaskCount > 0;
              return (
                <li key={a.id} className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      background: !a.online ? "#555" : warnFriday || warnPenny ? "#F59E0B" : "#1D9E75",
                    }}
                  />
                  <span className="truncate text-[var(--text-secondary)]">{a.name}</span>
                  {warnFriday && (
                    <span className="text-[#F59E0B] shrink-0" title="Human tasks">
                      {pendingTaskCount}
                    </span>
                  )}
                  {warnPenny && (
                    <span className="text-[#F59E0B] shrink-0" title="Pending approval">
                      {testingTaskCount}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

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
