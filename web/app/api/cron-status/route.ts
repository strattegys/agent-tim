import { NextRequest, NextResponse } from "next/server";
import {
  getCronJobSeedMetadata,
  getCronJobs,
  getCronSchedulerSnapshot,
  initCronJobs,
  serverCronsAllowed,
} from "@/lib/cron";
import { observabilityApiAllowed } from "@/lib/observability-gate";

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agent") || undefined;

  try {
    initCronJobs();
  } catch (e) {
    console.error("[api/cron-status] initCronJobs failed:", e);
  }

  const active = serverCronsAllowed();
  const runtimeById = new Map(getCronJobs(agentId).map((j) => [j.id, j]));

  let seeds = getCronJobSeedMetadata();
  if (agentId) {
    seeds = seeds.filter((s) => s.agentId === agentId);
  }

  const jobs = seeds.map((seed) => {
    const r = runtimeById.get(seed.id);
    return {
      id: seed.id,
      name: seed.name,
      schedule: seed.schedule,
      description: seed.description,
      logFile: seed.logFile,
      agentId: seed.agentId,
      enabled: seed.enabled,
      timeZone: seed.timeZone,
      lastRun: r?.lastRun ? r.lastRun.toISOString() : null,
      lastResult: r?.lastResult ?? null,
    };
  });

  const snap = getCronSchedulerSnapshot();

  return NextResponse.json({
    jobs,
    serverCronsActive: active,
    serverCronsNote: active
      ? undefined
      : "Timers run on the hosted server by default. On this machine: set CC_FORCE_SERVER_CRON=1 in web/.env.local to run them here, or use the list below as a read-only catalog.",
    scheduler: {
      schedulingAllowed: active,
      timersAttached: snap.timersAttached,
      registrySize: snap.registrySize,
      handlersSize: snap.handlersSize,
      /** When true, `pushWorkflowObservabilityEvent` writes `[workflow-trace]` lines (incl. cron_job after each run). */
      workflowTraceBufferOn: observabilityApiAllowed(),
    },
  });
}
