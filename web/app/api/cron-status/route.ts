import { NextRequest, NextResponse } from "next/server";
import { getCronJobs, initCronJobs, serverCronsAllowed } from "@/lib/cron";

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agent") || undefined;

  try {
    initCronJobs();
  } catch {
    /* non-fatal — empty registry if init fails */
  }

  const active = serverCronsAllowed();
  const jobs = getCronJobs(agentId).map((job) => ({
    id: job.id,
    name: job.name,
    schedule: job.schedule,
    description: job.description,
    logFile: job.logFile || null,
    agentId: job.agentId,
    enabled: job.enabled,
    timeZone: job.timeZone || null,
    lastRun: job.lastRun ? job.lastRun.toISOString() : null,
    lastResult: job.lastResult || null,
  }));

  return NextResponse.json({
    jobs,
    serverCronsActive: active,
    serverCronsNote: active
      ? undefined
      : "Scheduled jobs (LinkedIn drain, catch-up, discovery, heartbeats) run only on the hosted Command Central server, not on LOCALDEV/LOCALPROD or next dev.",
  });
}
