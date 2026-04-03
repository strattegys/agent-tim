"use client";

import useSWR from "swr";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type {
  ThroughputGoalStatus,
  WorkflowThroughputPayload,
  WorkflowThroughputRow,
  WorkflowThroughputMeasureRow,
} from "@/lib/workflow-throughput-types";

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(`Error ${r.status}`);
  return r.json() as Promise<T>;
}

type TimSummary = {
  count: number;
  pendingFollowUpCount?: number;
  linkedinInboundMessageCount?: number;
  unifiedMessagingCount?: number;
  warmOutreachDaily?: { sent: number; goal: number; status: string };
};

function statusColor(s: ThroughputGoalStatus): string {
  switch (s) {
    case "met": return "text-[#1D9E75]";
    case "on_track": return "text-[var(--text-secondary)]";
    case "behind": return "text-amber-500";
    case "at_risk": return "text-red-500";
    default: return "text-[var(--text-secondary)]";
  }
}

function statusBg(s: ThroughputGoalStatus): string {
  switch (s) {
    case "met": return "bg-[#1D9E75]/15 border-[#1D9E75]/40";
    case "on_track": return "bg-[var(--bg-secondary)] border-[var(--border-color)]";
    case "behind": return "bg-amber-500/15 border-amber-500/40";
    case "at_risk": return "bg-red-500/15 border-red-500/40";
    default: return "bg-[var(--bg-secondary)] border-[var(--border-color)]";
  }
}

function statusLabel(s: ThroughputGoalStatus): string {
  switch (s) {
    case "met": return "Met";
    case "on_track": return "On pace";
    case "behind": return "Behind";
    case "at_risk": return "At risk";
    default: return "";
  }
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">{value}</div>
      {sub ? <div className="text-[10px] text-[var(--text-tertiary)]">{sub}</div> : null}
    </div>
  );
}

function GoalCard({ row }: { row: WorkflowThroughputRow }) {
  const pct = row.target > 0 ? Math.min(100, (row.actual / row.target) * 100) : 0;
  return (
    <div className={`rounded-lg border p-3 ${statusBg(row.status)}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--text-primary)]">{row.workflowLabel}</p>
        <span className={`text-[10px] font-medium ${statusColor(row.status)}`}>
          {statusLabel(row.status)}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{row.actual}</span>
        <span className="text-sm text-[var(--text-tertiary)]">/ {row.target}</span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            row.status === "met" ? "bg-[#1D9E75]"
              : row.status === "at_risk" ? "bg-red-500"
                : row.status === "behind" ? "bg-amber-500"
                  : "bg-[#4a9eca]"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
        {row.period === "day" ? "Daily" : "Weekly"} · {row.metricLabel}
      </p>
    </div>
  );
}

function MeasureCard({ row }: { row: WorkflowThroughputMeasureRow }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <p className="text-xs font-semibold text-[var(--text-primary)]">{row.workflowLabel}</p>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{row.actual}</span>
        <span className="text-[10px] text-[var(--text-tertiary)]">today</span>
      </div>
      <p className="text-[10px] text-[var(--text-tertiary)] mt-1">{row.metricLabel}</p>
    </div>
  );
}

const TIM_WORKFLOW_TYPES = new Set([
  "linkedin-opener-sequence",
  "warm-outreach",
  "reply-to-close",
]);

export default function TimDashboardPanel() {
  const visible = useDocumentVisible();

  const { data: throughput } = useSWR<WorkflowThroughputPayload>(
    "/api/crm/workflow-throughput",
    (url: string) => fetchJson(url),
    { refreshInterval: visible ? 120_000 : 0, revalidateOnFocus: true, dedupingInterval: 15_000 },
  );

  const { data: summary } = useSWR<TimSummary>(
    "/api/crm/human-tasks?ownerAgent=tim&summary=1",
    (url: string) => fetchJson(url),
    { refreshInterval: visible ? 30_000 : 0, revalidateOnFocus: true, dedupingInterval: 10_000 },
  );

  const timGoals = (throughput?.items ?? []).filter(
    (r) => TIM_WORKFLOW_TYPES.has(r.workflowTypeId)
  );
  const timMeasures = (throughput?.measures ?? []).filter(
    (r) => TIM_WORKFLOW_TYPES.has(r.workflowTypeId)
  );

  const queueCount = summary?.count ?? 0;
  const followUps = summary?.pendingFollowUpCount ?? 0;
  const inbound = summary?.linkedinInboundMessageCount ?? 0;
  const daily = summary?.warmOutreachDaily;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[var(--bg-primary)] px-3 py-3 space-y-3">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">Tim — Outreach overview</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Queue depth" value={queueCount} sub="human tasks pending" />
        <Stat label="Follow-ups due" value={followUps} />
        <Stat label="Inbound messages" value={inbound} />
        {daily ? (
          <Stat
            label="Warm outreach today"
            value={`${daily.sent} / ${daily.goal}`}
            sub={daily.status}
          />
        ) : (
          <Stat label="Warm outreach today" value="—" />
        )}
      </div>

      {timGoals.length > 0 ? (
        <>
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] px-1">
            Goals
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {timGoals.map((row) => (
              <GoalCard key={row.workflowTypeId} row={row} />
            ))}
          </div>
        </>
      ) : null}

      {timMeasures.length > 0 ? (
        <>
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] px-1">
            Measured throughput
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {timMeasures.map((row) => (
              <MeasureCard key={row.workflowTypeId} row={row} />
            ))}
          </div>
        </>
      ) : null}

      {timGoals.length === 0 && timMeasures.length === 0 ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/40 p-4 text-center">
          <p className="text-xs text-[var(--text-tertiary)]">
            No active throughput goals for Tim. Activate a package with a warm outreach or opener workflow.
          </p>
        </div>
      ) : null}
    </div>
  );
}
