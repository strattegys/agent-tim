"use client";

import useSWR from "swr";
import { useDocumentVisible } from "@/lib/use-document-visible";

export type CronStatusBeneficiary = {
  id: string;
  name: string;
};

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
  beneficiaries?: CronStatusBeneficiary[];
  paused?: boolean;
  pauseFromEnv?: boolean;
  pauseFromFile?: boolean;
};

export type CronStatusSource = "hosted" | "this_process" | "local_catalog" | "error";

export type CronStatusResponse = {
  jobs: CronStatusJob[];
  /** On the hosted process: whether node-cron is allowed (false if CC_DISABLE_SERVER_CRON). */
  serverCronsActive?: boolean;
  cronStatusSource?: CronStatusSource;
  /** When cronStatusSource is local_catalog: how to enable hosted proxy. */
  cronStatusMessage?: string;
  /** Whether POST /api/cron/pause can apply (false when only local catalog, no hosted link). */
  cronPauseEditable?: boolean;
  error?: string;
  httpStatus?: number;
  detail?: string;
};

async function fetchCronStatus(url: string): Promise<CronStatusResponse> {
  const r = await fetch(url, { credentials: "include", cache: "no-store" });
  const data = (await r.json().catch(() => ({}))) as CronStatusResponse;
  if (!r.ok) {
    const hint =
      data.error === "hosted_cron_status_failed"
        ? `Hosted cron status failed (HTTP ${data.httpStatus ?? r.status}). Check CC_HOSTED_APP_URL and INTERNAL_API_KEY.`
        : data.error === "hosted_cron_status_unreachable"
          ? `Could not reach hosted app: ${data.detail ?? r.status}`
          : data.detail || `HTTP ${r.status}`;
    throw new Error(hint);
  }
  return data;
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
  return jobs.filter(
    (j) =>
      j.enabled &&
      j.lastResult?.startsWith("error") &&
      !j.paused
  );
}
