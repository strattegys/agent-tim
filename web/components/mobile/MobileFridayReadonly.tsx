"use client";

import { useMemo } from "react";
import { useCronStatus, cronJobsWithErrors } from "@/lib/use-cron-status";

export function MobileFridayReadonly() {
  const { data, error, isLoading } = useCronStatus(true);
  const errorJobs = useMemo(() => cronJobsWithErrors(data?.jobs), [data?.jobs]);

  if (isLoading) {
    return <p className="text-sm text-[#8b9bab]">Loading cron status…</p>;
  }
  if (error) {
    return (
      <p className="text-sm text-red-400">
        {error instanceof Error ? error.message : "Could not load cron status"}
      </p>
    );
  }

  const jobs = data?.jobs ?? [];
  const serverCrons = data?.serverCronsActive;

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-snug text-[#8b9bab]">
        Read-only snapshot of scheduled jobs (Friday). Full dashboards stay on desktop Command
        Central.
      </p>
      <div className="rounded-lg border border-white/10 bg-[#0e1621] p-3 text-xs">
        <p className="font-medium text-[#f5f5f5]">Server crons</p>
        <p className="mt-1 text-[#9ca3af]">
          {serverCrons === false
            ? "Inactive on this process (CC_DISABLE_SERVER_CRON or catalog-only)."
            : serverCrons === true
              ? "Active in this Node process."
              : "—"}
        </p>
        {data?.cronStatusMessage ? (
          <p className="mt-2 text-[#8b9bab]">{data.cronStatusMessage}</p>
        ) : null}
      </div>
      {errorJobs.length > 0 ? (
        <div className="rounded-lg border border-red-500/40 bg-red-950/30 p-3">
          <p className="text-xs font-semibold text-red-300">
            {errorJobs.length} job(s) with last-run errors
          </p>
        </div>
      ) : null}
      <ul className="space-y-2">
        {jobs.map((j) => {
          const err = j.lastResult && !/^ok/i.test(j.lastResult.trim());
          return (
            <li
              key={j.id}
              className={`rounded-lg border p-3 text-xs ${
                err ? "border-amber-500/40 bg-amber-950/20" : "border-white/10 bg-[#0e1621]"
              }`}
            >
              <p className="font-medium text-[#f5f5f5]">{j.name}</p>
              <p className="mt-1 font-mono text-[10px] text-[#6b8a9e]">{j.schedule}</p>
              <p className="mt-1 text-[#9ca3af]">{j.description}</p>
              {j.lastRun ? (
                <p className="mt-1 text-[10px] text-[#5c6d7c]">Last run: {j.lastRun}</p>
              ) : null}
              {j.lastResult ? (
                <p className="mt-1 line-clamp-3 text-[10px] text-[#b8c0c8]">{j.lastResult}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
