"use client";

import useSWR from "swr";
import { useDocumentVisible } from "@/lib/use-document-visible";

export type CronStatusJob = {
  id: string;
  name: string;
  schedule: string;
  description: string;
  logFile: string | null;
  agentId: string;
  enabled: boolean;
  timeZone: string | null;
  lastRun: string | null;
  lastResult: string | null;
};

export type CronSchedulerStatus = {
  schedulingAllowed: boolean;
  timersAttached: number;
  registrySize: number;
  handlersSize: number;
  workflowTraceBufferOn: boolean;
};

export type CronStatusResponse = {
  jobs: CronStatusJob[];
  /** True only when this process may run node-cron timers (hosted prod, or CC_FORCE_SERVER_CRON=1 locally). */
  serverCronsActive?: boolean;
  serverCronsNote?: string;
  scheduler?: CronSchedulerStatus;
};

async function fetchCronStatus(url: string): Promise<CronStatusResponse> {
  const r = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<CronStatusResponse>;
}

/** Polls `/api/cron-status` when `enabled` — SWR dedupes across Friday work button, dashboard banner, and Cron tab. */
export function useCronStatus(enabled: boolean) {
  const visible = useDocumentVisible();
  return useSWR(enabled ? "/api/cron-status" : null, fetchCronStatus, {
    refreshInterval: visible ? 30_000 : 0,
    revalidateOnFocus: true,
    dedupingInterval: 10_000,
  });
}

export function cronJobsWithErrors(jobs: CronStatusJob[] | undefined): CronStatusJob[] {
  if (!jobs?.length) return [];
  return jobs.filter((j) => j.enabled && j.lastResult?.startsWith("error"));
}
