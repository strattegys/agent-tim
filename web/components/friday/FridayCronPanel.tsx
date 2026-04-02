"use client";

import { useState } from "react";
import { useCronStatus, cronJobsWithErrors } from "@/lib/use-cron-status";

const AGENT_COLORS: Record<string, string> = {
  friday: "#9B59B6",
  tim: "#1D9E75",
  suzi: "#D85A30",
  scout: "#2563EB",
  marni: "#D4A017",
  king: "#5a6d7a",
  ghost: "#4A90D9",
  penny: "#E67E22",
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
  const [pauseBusyId, setPauseBusyId] = useState<string | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);

  const { data, error: swrError, isLoading: loading, mutate: refresh } = useCronStatus(true);

  const jobs = data?.jobs ?? [];
  const source = data?.cronStatusSource;

  const error = swrError ? (swrError instanceof Error ? swrError.message : "Network error") : null;

  const agentIds = [...new Set(jobs.map((j) => j.agentId))].sort();

  const filtered = filter === "all" ? jobs : jobs.filter((j) => j.agentId === filter);

  const enabledCount = jobs.filter((j) => j.enabled).length;
  const cronErrors = cronJobsWithErrors(jobs);
  const errorCount = cronErrors.length;

  const headerLine =
    source === "hosted"
      ? "Live job status from production (refreshes about every 30 seconds). Pause toggles call production and update live crons after deploy."
      : source === "this_process"
        ? "Live job status from this server process (refreshes about every 30 seconds)."
        : source === "local_catalog"
          ? "Cron jobs never run on this machine; configure the lines below to load live status from production."
          : "Cron status source unknown.";

  async function setFilePause(jobId: string, paused: boolean) {
    setPauseBusyId(jobId);
    setPauseError(null);
    try {
      const r = await fetch("/api/cron/pause", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, paused }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!r.ok) {
        throw new Error(body.detail || body.error || `HTTP ${r.status}`);
      }
      await refresh();
    } catch (e) {
      setPauseError(e instanceof Error ? e.message : String(e));
    } finally {
      setPauseBusyId(null);
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Cron Hub</h2>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5 max-w-xl">{headerLine}</p>
          {source === "this_process" && data?.serverCronsActive === false ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1 max-w-xl">
              Scheduling is disabled on this host (<code className="text-[10px]">CC_DISABLE_SERVER_CRON</code>
              ). Last-run times may be stale.
            </p>
          ) : null}
          {source === "this_process" && enabledCount > 0 && errorCount === 0 ? (
            <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
              {enabledCount} enabled job{enabledCount === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
        <div className="flex items-start gap-2 shrink-0">
          {errorCount > 0 ? (
            <div
              role="alert"
              className="rounded-md border border-red-500/35 bg-red-500/10 px-2.5 py-1.5 text-[10px] max-w-[260px]"
            >
              <p className="font-semibold text-red-600 dark:text-red-400">
                {errorCount} job{errorCount === 1 ? "" : "s"} failed
              </p>
              <ul className="mt-1 space-y-0.5 text-[var(--text-tertiary)]">
                {cronErrors.slice(0, 3).map((j) => (
                  <li key={j.id} className="truncate">
                    <span className="font-mono">{j.id}</span>
                    {j.lastResult ? (
                      <span className="text-red-500/80"> — {j.lastResult.replace(/^error:\s*/i, "").slice(0, 60)}</span>
                    ) : null}
                  </li>
                ))}
                {errorCount > 3 ? <li className="text-[var(--text-tertiary)]">+{errorCount - 3} more</li> : null}
              </ul>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-[11px] px-2 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
          >
            Refresh
          </button>
        </div>
      </div>

      {pauseError ? (
        <p className="text-[11px] text-red-600 dark:text-red-400" role="alert">
          {pauseError}
        </p>
      ) : null}

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

      {source === "local_catalog" && data?.cronStatusMessage ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
          <p className="font-semibold text-[var(--text-primary)]">Connect to hosted status</p>
          <p className="mt-1">{data.cronStatusMessage}</p>
        </div>
      ) : null}

      {/* Loading / error */}
      {loading && !data ? (
        <p className="text-xs text-[var(--text-tertiary)]">Loading...</p>
      ) : error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {/* Job list */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {filtered.map((job) => {
          const isError = job.lastResult?.startsWith("error");
          const isSuccess = job.lastResult === "success";
          const isPausedRun = job.lastResult === "paused";
          const color = AGENT_COLORS[job.agentId] ?? "var(--text-secondary)";
          const beneficiaries = job.beneficiaries ?? [];
          const pauseEditable = data?.cronPauseEditable === true;
          const pauseFromFile = job.pauseFromFile === true;
          const pauseFromEnv = job.pauseFromEnv === true;
          const visuallyPaused = job.paused === true;

          return (
            <article
              key={job.id}
              className={`rounded-lg border bg-[var(--bg-primary)] p-3 shadow-sm flex flex-col ${
                !job.enabled
                  ? "border-[var(--border-color)] opacity-50"
                  : isError
                    ? "border-red-500/40"
                    : "border-[var(--border-color)]"
              } ${visuallyPaused && job.enabled ? "ring-1 ring-amber-500/25" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                      {job.name}
                    </p>
                    {!job.enabled && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shrink-0">
                        disabled
                      </span>
                    )}
                    {!job.enabled && pauseFromFile ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/12 text-amber-800 dark:text-amber-200 shrink-0">
                        pause when enabled
                      </span>
                    ) : null}
                    {visuallyPaused && job.enabled ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-800 dark:text-amber-200 shrink-0">
                        paused
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 line-clamp-2">
                    {job.description}
                  </p>
                </div>
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
                  style={{ color, backgroundColor: `${color}15` }}
                  title="Owning agent (registry / Friday hub)"
                >
                  {job.agentId}
                </span>
              </div>

              {beneficiaries.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="text-[9px] text-[var(--text-tertiary)] shrink-0">Benefits</span>
                  {beneficiaries.map((b) => {
                    const bc = AGENT_COLORS[b.id] ?? "var(--text-secondary)";
                    return (
                      <span
                        key={b.id}
                        className="text-[9px] font-medium px-1.5 py-0.5 rounded"
                        style={{ color: bc, backgroundColor: `${bc}12` }}
                        title="Primary beneficiary"
                      >
                        {b.name}
                      </span>
                    );
                  })}
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--text-tertiary)]">
                <span title={job.schedule}>
                  {cronToHuman(job.schedule)}
                  {job.timeZone ? ` (${job.timeZone.replace("America/", "")})` : ""}
                </span>
                <span>Last run: {formatLastRun(job.lastRun)}</span>
                {job.lastResult ? (
                  <span
                    className={
                      isError
                        ? "text-red-500"
                        : isSuccess
                          ? "text-[#1D9E75]"
                          : isPausedRun
                            ? "text-amber-700 dark:text-amber-300"
                            : ""
                    }
                  >
                    {isError ? job.lastResult.slice(0, 80) : job.lastResult}
                  </span>
                ) : null}
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--text-tertiary)]">
                <code className="text-[9px] bg-[var(--bg-secondary)] px-1 py-0.5 rounded font-mono truncate max-w-[min(100%,14rem)]">
                  {job.id}
                </code>
                {pauseEditable ? (
                  <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="rounded border-[var(--border-color)]"
                      checked={pauseFromFile}
                      disabled={pauseBusyId === job.id}
                      onChange={(e) => void setFilePause(job.id, e.target.checked)}
                    />
                    <span className="text-[9px] text-[var(--text-secondary)]">Pause (saved on server)</span>
                  </label>
                ) : null}
              </div>
              {!job.enabled && pauseEditable ? (
                <p className="mt-1 text-[9px] text-[var(--text-tertiary)] leading-snug">
                  Not scheduled (disabled in registry). Checking pause still saves on the server so this job
                  stays skipped if you enable it in code later.
                </p>
              ) : null}
              {pauseFromEnv ? (
                <p className="mt-1.5 text-[9px] text-amber-800/90 dark:text-amber-200/90">
                  Also listed in <code className="font-mono">CC_CRON_PAUSED_IDS</code> — remove there to fully unpause.
                </p>
              ) : null}
            </article>
          );
        })}
      </div>

      {filtered.length === 0 && !loading ? (
        <p className="text-xs text-[var(--text-tertiary)]">
          {filter === "all" ? "No cron jobs registered." : `No jobs for "${filter}".`}
        </p>
      ) : null}
    </div>
  );
}
