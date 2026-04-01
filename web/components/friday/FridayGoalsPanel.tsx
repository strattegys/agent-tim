"use client";

import useSWR from "swr";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type {
  ThroughputGoalStatus,
  WorkflowThroughputMeasureRow,
  WorkflowThroughputPayload,
} from "@/lib/workflow-throughput-types";

function statusStyles(status: ThroughputGoalStatus): {
  border: string;
  badge: string;
  badgeText: string;
} {
  switch (status) {
    case "met":
      return {
        border: "border-[#1D9E75]/50",
        badge: "bg-[#1D9E75]/15",
        badgeText: "text-[#1D9E75]",
      };
    case "on_track":
      return {
        border: "border-[var(--border-color)]",
        badge: "bg-[var(--bg-secondary)]",
        badgeText: "text-[var(--text-secondary)]",
      };
    case "behind":
      return {
        border: "border-amber-500/55",
        badge: "bg-amber-500/15",
        badgeText: "text-amber-600 dark:text-amber-400",
      };
    case "at_risk":
      return {
        border: "border-red-500/50",
        badge: "bg-red-500/15",
        badgeText: "text-red-600 dark:text-red-400",
      };
    default:
      return {
        border: "border-[var(--border-color)]",
        badge: "bg-[var(--bg-secondary)]",
        badgeText: "text-[var(--text-secondary)]",
      };
  }
}

function statusLabel(status: ThroughputGoalStatus): string {
  switch (status) {
    case "met":
      return "Goal met";
    case "on_track":
      return "On pace";
    case "behind":
      return "Behind pace";
    case "at_risk":
      return "Below goal";
    default:
      return "";
  }
}

function formatWindow(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function FridayGoalsPanel() {
  const visible = useDocumentVisible();

  const { data: data = null, error: swrError, isLoading: loading, mutate: refreshGoals } = useSWR<WorkflowThroughputPayload>(
    "/api/crm/workflow-throughput",
    async (url: string) => {
      const r = await fetch(url, { credentials: "include", cache: "no-store" });
      if (!r.ok) {
        let extra = "";
        try {
          const errBody = (await r.json()) as { detail?: string; error?: string };
          if (errBody.detail) extra = `: ${errBody.detail}`;
          else if (errBody.error && errBody.error !== "Failed to load throughput") extra = `: ${errBody.error}`;
        } catch { /* ignore */ }
        throw new Error(`Could not load goals (${r.status})${extra}`);
      }
      return r.json() as Promise<WorkflowThroughputPayload>;
    },
    {
      refreshInterval: visible ? 120_000 : 0,
      revalidateOnFocus: true,
      dedupingInterval: 15_000,
    },
  );

  const error = swrError
    ? (swrError instanceof Error ? swrError.message : "Network error loading goals")
    : null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Workflow goals</h2>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5 max-w-xl">
            Goals: daily/weekly targets from the merged registry. Measured throughput (second section): counts with
            no target (Reply to Close follows LinkedIn opener volume). Period: {data?.timezone ?? "America/New_York"}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshGoals()}
          className="text-[11px] px-2 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
        >
          Refresh
        </button>
      </div>

      {loading && !data ? (
        <p className="text-xs text-[var(--text-tertiary)]">Loading…</p>
      ) : error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {(data?.items ?? []).length > 0 ? (
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">Goals (targets)</h3>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
        {(data?.items ?? []).map((row) => {
          const pct = row.target > 0 ? Math.min(100, (row.actual / row.target) * 100) : 0;
          const st = statusStyles(row.status);
          return (
            <article
              key={row.workflowTypeId}
              className={`rounded-lg border bg-[var(--bg-primary)] p-3 shadow-sm ${st.border}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-[var(--text-primary)]">{row.workflowLabel}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                    {row.ownerLabel} · {row.period === "day" ? "Daily" : "Weekly"} target: {row.target}
                  </p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${st.badge} ${st.badgeText}`}>
                  {statusLabel(row.status)}
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] mt-2 leading-snug">{row.metricLabel}</p>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]">{row.actual}</span>
                <span className="text-sm text-[var(--text-tertiary)]">/ {row.target}</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    row.status === "met"
                      ? "bg-[#1D9E75]"
                      : row.status === "at_risk"
                        ? "bg-red-500"
                        : row.status === "behind"
                          ? "bg-amber-500"
                          : "bg-[#4a9eca]"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--text-tertiary)]">
                <span>
                  Window: {formatWindow(row.windowStart)} → {formatWindow(row.windowEnd)}
                </span>
                {row.period === "day" && row.status !== "met" ? (
                  <span title="Rough pace check (~85% of proportional target by now)">
                    Pace floor: ~{row.minExpectedByNow} by now
                  </span>
                ) : null}
                {row.period === "week" && row.status !== "met" ? (
                  <span title="Rough pace check (~85% of proportional target by now)">
                    Pace floor: ~{row.minExpectedByNow} by now
                  </span>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {(data?.measures ?? []).length > 0 ? (
        <div className={`space-y-2 ${(data?.items ?? []).length > 0 ? "mt-4" : ""}`}>
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">Measured throughput (no target)</h3>
          <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
            {(data?.measures ?? []).map((row: WorkflowThroughputMeasureRow) => (
              <article
                key={row.workflowTypeId}
                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-primary)]">{row.workflowLabel}</p>
                    <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                      {row.ownerLabel} · {row.period === "day" ? "Today’s count" : "This week’s count"} · no goal
                    </p>
                  </div>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                    Measured
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] mt-2 leading-snug">{row.metricLabel}</p>
                <div className="mt-3">
                  <span className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]">{row.actual}</span>
                  <span className="text-sm text-[var(--text-tertiary)] ml-1">in window</span>
                </div>
                <div className="mt-2 text-[10px] text-[var(--text-tertiary)]">
                  Window: {formatWindow(row.windowStart)} → {formatWindow(row.windowEnd)}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {data?.items?.length === 0 && !(data?.measures?.length) && !loading ? (
        <p className="text-xs text-[var(--text-tertiary)]">
          No workflow types define <code className="text-[10px]">throughputGoal</code> yet. Add one in{" "}
          <code className="text-[10px]">workflow-types.ts</code>.
        </p>
      ) : null}

      {data?.note ? <p className="text-[10px] text-[var(--text-tertiary)] max-w-3xl">{data.note}</p> : null}
    </div>
  );
}
