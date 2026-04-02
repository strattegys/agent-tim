"use client";

import { useState } from "react";
import { useCronStatus, type CronStatusJob } from "@/lib/use-cron-status";

type CronJob = CronStatusJob;

const AGENT_COLORS: Record<string, string> = {
  friday: "#9B59B6",
  tim: "#1D9E75",
  suzi: "#D85A30",
  scout: "#2563EB",
  marni: "#D4A017",
  king: "#5a6d7a",
  ghost: "#4A90D9",
};

function cronToHuman(cron: string): string {
  if (cron === "* * * * *") return "Every minute";
  const m = cron.match(/^\*\/(\d+) \* \* \* \*$/);
  if (m) return `Every ${m[1]} min`;
  const hourly = cron.match(/^(\d+) \* \* \* \*$/);
  if (hourly) return `Hourly at :${hourly[1].padStart(2, "0")}`;
  const daily = cron.match(/^(\d+) (\d+) \* \* \*$/);
  if (daily) return `Daily at ${daily[2]}:${daily[1].padStart(2, "0")}`;
  const monthly = cron.match(/^(\d+) (\d+) (\d+) \* \*$/);
  if (monthly) return `Monthly (day ${monthly[3]}) at ${monthly[2]}:${monthly[1].padStart(2, "0")}`;
  const weekly = cron.match(/^(\d+) (\d+) \* \* (\d)$/);
  if (weekly) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${days[+weekly[3]] ?? `Day ${weekly[3]}`} at ${weekly[2]}:${weekly[1].padStart(2, "0")}`;
  }
  const weekdays = cron.match(/^(\d+) (\d+) \* \* 1-5$/);
  if (weekdays) return `Weekdays at ${weekdays[2]}:${weekdays[1].padStart(2, "0")}`;
  return cron;
}

function formatLastRun(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    if (diffMs < 60_000) return "Just now";
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function FridayCronPanel() {
  const [filter, setFilter] = useState<string>("all");

  const { data, error: swrError, isLoading: loading, mutate: refresh } = useCronStatus(true);

  const jobs = data?.jobs ?? [];
  /** Strict: undefined must not look “on” (avoids wrong copy when API omits the flag). */
  const schedulingAllowed = data?.serverCronsActive === true;
  const sch = data?.scheduler;
  const timersAttached = sch?.timersAttached ?? 0;
  const traceBufferOn = sch?.workflowTraceBufferOn ?? false;

  const error = swrError ? (swrError instanceof Error ? swrError.message : "Network error") : null;

  const agentIds = [...new Set(jobs.map((j) => j.agentId))].sort();

  const filtered = filter === "all" ? jobs : jobs.filter((j) => j.agentId === filter);

  const enabledCount = jobs.filter((j) => j.enabled).length;
  const errorCount = jobs.filter((j) => j.lastResult?.startsWith("error")).length;
  const timersMissing =
    schedulingAllowed && !loading && enabledCount > 0 && timersAttached === 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Cron Hub</h2>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5 max-w-xl">
            {schedulingAllowed ? (
              <>
                Scheduling is allowed on this process. {enabledCount} job{enabledCount === 1 ? "" : "s"} enabled
                {errorCount > 0 ? `; ${errorCount} with errors` : ""}.{" "}
                {sch ? (
                  <>
                    node-cron timers attached: <strong>{timersAttached}</strong>
                    {traceBufferOn ? " · workflow-trace buffer on" : " · workflow-trace buffer off"}.
                  </>
                ) : null}
              </>
            ) : (
              <>
                Read-only catalog: <code className="text-[10px]">next dev</code> / LOCALDEV / LOCALPROD do not run
                timers unless <code className="text-[10px]">CC_FORCE_SERVER_CRON=1</code> — so{" "}
                <strong>last run stays empty</strong> here. Traces still buffer in{" "}
                <code className="text-[10px]">next dev</code> for other events; cron lines only appear after a job
                actually runs.
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-[11px] px-2 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
        >
          Refresh
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
            filter === "all"
              ? "font-semibold text-[var(--text-primary)] border-[var(--text-primary)]/30 bg-[var(--bg-secondary)]"
              : "text-[var(--text-tertiary)] border-[var(--border-color)] hover:text-[var(--text-secondary)]"
          }`}
        >
          All ({jobs.length})
        </button>
        {agentIds.map((aid) => {
          const count = jobs.filter((j) => j.agentId === aid).length;
          const color = AGENT_COLORS[aid] ?? "var(--text-secondary)";
          return (
            <button
              key={aid}
              type="button"
              onClick={() => setFilter(aid)}
              className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                filter === aid
                  ? "font-semibold border-current bg-[var(--bg-secondary)]"
                  : "border-[var(--border-color)] hover:border-current"
              }`}
              style={{ color }}
            >
              {aid} ({count})
            </button>
          );
        })}
      </div>

      {timersMissing ? (
        <div
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-[var(--text-secondary)]"
        >
          <p className="font-semibold text-amber-800 dark:text-amber-200">Timers not attached</p>
          <p className="mt-1">
            Scheduling is allowed but <strong>node-cron has 0 tasks</strong>. Restart <code className="text-[10px]">next dev</code> after adding{" "}
            <code className="text-[10px]">CC_FORCE_SERVER_CRON=1</code>, then open this tab again (or hit Refresh). If this is the{" "}
            <strong>hosted</strong> server, check deploy logs and that <code className="text-[10px]">CC_DISABLE_SERVER_CRON</code> is not set.
          </p>
        </div>
      ) : null}

      {!schedulingAllowed && !loading ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
          <p className="font-semibold text-[var(--text-primary)]">Timers off on this runtime</p>
          <p className="mt-1">
            {data?.serverCronsNote ||
              "Background crons (LinkedIn inbox, catch-up, discovery, heartbeats) do not run on LOCALDEV, LOCALPROD, or next dev. They run on the DigitalOcean deployment. Open the hosted app’s Friday → Cron tab to see live last-run lines, or check workflow traces in the Observation Post when enabled."}
          </p>
          <p className="mt-1 text-[var(--text-tertiary)]">
            Local override (not for production): <code className="text-[10px]">CC_FORCE_SERVER_CRON=1</code> in{" "}
            <code className="text-[10px]">web/.env.local</code>, then restart <code className="text-[10px]">next dev</code>{" "}
            if the var was new — or open this tab / hit Refresh so timers attach after the first registry init.
          </p>
        </div>
      ) : null}

      {/* Loading / error */}
      {loading && !data ? (
        <p className="text-xs text-[var(--text-tertiary)]">Loading...</p>
      ) : error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {/* Job list */}
      <div className="space-y-2">
        {filtered.map((job) => {
          const isError = job.lastResult?.startsWith("error");
          const isSuccess = job.lastResult === "success";
          const color = AGENT_COLORS[job.agentId] ?? "var(--text-secondary)";

          return (
            <article
              key={job.id}
              className={`rounded-lg border bg-[var(--bg-primary)] p-3 shadow-sm ${
                !job.enabled
                  ? "border-[var(--border-color)] opacity-50"
                  : isError
                    ? "border-red-500/40"
                    : "border-[var(--border-color)]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                      {job.name}
                    </p>
                    {!job.enabled && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shrink-0">
                        disabled
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 truncate">
                    {job.description}
                  </p>
                </div>
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
                  style={{ color, backgroundColor: `${color}15` }}
                >
                  {job.agentId}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--text-tertiary)]">
                <span title={job.schedule}>
                  {cronToHuman(job.schedule)}
                  {job.timeZone ? ` (${job.timeZone.replace("America/", "")})` : ""}
                </span>
                <span>
                  Last run: {formatLastRun(job.lastRun)}
                </span>
                {job.lastResult && (
                  <span className={isError ? "text-red-500" : isSuccess ? "text-[#1D9E75]" : ""}>
                    {isError ? job.lastResult.slice(0, 80) : job.lastResult}
                  </span>
                )}
              </div>

              <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
                <code className="text-[9px] bg-[var(--bg-secondary)] px-1 py-0.5 rounded font-mono">
                  {job.id}
                </code>
              </div>
            </article>
          );
        })}
      </div>

      {filtered.length === 0 && !loading && schedulingAllowed ? (
        <p className="text-xs text-[var(--text-tertiary)]">
          {filter === "all" ? "No cron jobs registered." : `No jobs for "${filter}".`}
        </p>
      ) : null}
    </div>
  );
}
