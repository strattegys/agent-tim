import { NextRequest, NextResponse } from "next/server";
import {
  getCronJobBeneficiaryRows,
  getCronJobSeedMetadata,
  getCronJobs,
  initCronJobs,
  serverCronsAllowed,
  type CronJobConfig,
  type CronJobListSeed,
} from "@/lib/cron";
import { getCronPauseDetailsForJob, getFilePausedCronJobIds } from "@/lib/cron-pause";
import {
  getHostedCommandCentralOrigin,
  isCommandCentralLocalRuntime,
  resolveCronStatusInternalKey,
} from "@/lib/cron-runtime-context";

export const runtime = "nodejs";

function buildCronStatusJobRow(
  seed: CronJobListSeed,
  runtimeJob: CronJobConfig | undefined,
  pauseDetailSource: "live" | "none"
) {
  const beneficiaries = getCronJobBeneficiaryRows(seed.id);
  const pause =
    pauseDetailSource === "live"
      ? getCronPauseDetailsForJob(seed.id)
      : { paused: false, fromEnv: false, fromFile: false };

  return {
    id: seed.id,
    name: seed.name,
    schedule: seed.schedule,
    description: seed.description,
    logFile: seed.logFile,
    agentId: seed.agentId,
    enabled: seed.enabled,
    timeZone: seed.timeZone,
    beneficiaries,
    paused: pause.paused,
    pauseFromEnv: pause.fromEnv,
    pauseFromFile: pause.fromFile,
    lastRun: runtimeJob?.lastRun ? runtimeJob.lastRun.toISOString() : null,
    lastResult: runtimeJob?.lastResult ?? null,
  };
}

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
          const localFilePaused = new Set(getFilePausedCronJobIds());
          const rawJobs = data.jobs;
          const jobs =
            Array.isArray(rawJobs) && localFilePaused.size > 0
              ? rawJobs.map((row) => {
                  const job = row as Record<string, unknown>;
                  const id = typeof job.id === "string" ? job.id : "";
                  if (!id) return row;
                  const fromLocalFile = localFilePaused.has(id);
                  const pauseFromFile = Boolean(job.pauseFromFile) || fromLocalFile;
                  const pauseFromEnv = Boolean(job.pauseFromEnv);
                  const paused = pauseFromEnv || pauseFromFile;
                  return { ...job, pauseFromFile, paused };
                })
              : rawJobs;
          return NextResponse.json({
            ...data,
            jobs,
            cronStatusSource: "hosted",
            cronPauseEditable: true,
          });
        }
        const text = await r.text().catch(() => "");
        const unauthorized =
          r.status === 401
            ? "Hosted server rejected x-internal-key — use the same INTERNAL_API_KEY as web/.env.local on the droplet (see scripts/patch-server-internal-api-key.mjs)."
            : text.slice(0, 240);
        return NextResponse.json(
          {
            error: "hosted_cron_status_failed",
            httpStatus: r.status,
            detail: unauthorized,
            jobs: [],
            cronStatusSource: "error",
            cronPauseEditable: false,
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
            cronPauseEditable: false,
          },
          { status: 502 }
        );
      }
    }

    let seeds = getCronJobSeedMetadata();
    if (agentId) {
      seeds = seeds.filter((s) => s.agentId === agentId);
    }
    const jobs = seeds.map((seed) =>
      buildCronStatusJobRow(seed, undefined, "none")
    );
    const cronStatusMessage = !internalKey
      ? "Add INTERNAL_API_KEY to web/.env.local — it must match the hosted droplet (same file the server uses). See scripts/patch-server-internal-api-key.mjs. Optional: CC_HOSTED_INTERNAL_API_KEY if you keep a different local key."
      : "Set CC_HOSTED_APP_URL to a valid https:// origin, or remove it to use the default production host.";
    return NextResponse.json({
      jobs,
      serverCronsActive: false,
      cronStatusSource: "local_catalog",
      cronStatusMessage,
      cronPauseEditable: false,
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
    return buildCronStatusJobRow(seed, r, "live");
  });

  return NextResponse.json({
    jobs,
    serverCronsActive: active,
    cronStatusSource: "this_process",
    cronPauseEditable: true,
  });
}
