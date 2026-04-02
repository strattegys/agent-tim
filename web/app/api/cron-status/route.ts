import { NextRequest, NextResponse } from "next/server";
import {
  getCronJobSeedMetadata,
  getCronJobs,
  initCronJobs,
  serverCronsAllowed,
} from "@/lib/cron";
import {
  getHostedCommandCentralOrigin,
  isCommandCentralLocalRuntime,
  resolveCronStatusInternalKey,
} from "@/lib/cron-runtime-context";

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agent") || undefined;

  if (isCommandCentralLocalRuntime()) {
    const origin = getHostedCommandCentralOrigin();
    const internalKey = resolveCronStatusInternalKey();
    if (origin && internalKey) {
      const url = new URL("/api/cron-status", origin);
      if (agentId) url.searchParams.set("agent", agentId);
      try {
        const r = await fetch(url.toString(), {
          headers: { "x-internal-key": internalKey },
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        if (r.ok) {
          const data = (await r.json()) as Record<string, unknown>;
          return NextResponse.json({ ...data, cronStatusSource: "hosted" });
        }
        const text = await r.text().catch(() => "");
        return NextResponse.json(
          {
            error: "hosted_cron_status_failed",
            httpStatus: r.status,
            detail: text.slice(0, 240),
            jobs: [],
            cronStatusSource: "error",
          },
          { status: 502 }
        );
      } catch (e) {
        return NextResponse.json(
          {
            error: "hosted_cron_status_unreachable",
            detail: e instanceof Error ? e.message : String(e),
            jobs: [],
            cronStatusSource: "error",
          },
          { status: 502 }
        );
      }
    }

    let seeds = getCronJobSeedMetadata();
    if (agentId) {
      seeds = seeds.filter((s) => s.agentId === agentId);
    }
    const jobs = seeds.map((seed) => ({
      id: seed.id,
      name: seed.name,
      schedule: seed.schedule,
      description: seed.description,
      logFile: seed.logFile,
      agentId: seed.agentId,
      enabled: seed.enabled,
      timeZone: seed.timeZone,
      lastRun: null,
      lastResult: null,
    }));
    const cronStatusMessage = !origin
      ? "Set CC_HOSTED_APP_URL in web/.env.local to your hosted Command Central origin (https://…)."
      : "Set INTERNAL_API_KEY (same as on the hosted server) or CC_HOSTED_INTERNAL_API_KEY so this app can load live cron status.";
    return NextResponse.json({
      jobs,
      serverCronsActive: false,
      cronStatusSource: "local_catalog",
      cronStatusMessage,
    });
  }

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

  return NextResponse.json({
    jobs,
    serverCronsActive: active,
    cronStatusSource: "this_process",
  });
}
