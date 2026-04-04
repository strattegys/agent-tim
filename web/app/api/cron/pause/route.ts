import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCronJobSeedMetadata } from "@/lib/cron-job-catalog";
import {
  getHostedCommandCentralOrigin,
  isCommandCentralLocalRuntime,
  resolveCronStatusInternalKey,
} from "@/lib/cron-runtime-context";
import { setCronJobFilePaused } from "@/lib/cron-pause";

export const runtime = "nodejs";

function knownJobIds(): Set<string> {
  return new Set(getCronJobSeedMetadata().map((s) => s.id));
}

export async function POST(req: NextRequest) {
  const expectedKey = resolveCronStatusInternalKey();
  const internalKey = req.headers.get("x-internal-key")?.trim();
  const keyAuthorized = Boolean(expectedKey && internalKey && internalKey === expectedKey);

  const session = await auth();
  if (!keyAuthorized && !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    jobId?: string;
    paused?: boolean;
  } | null;
  if (!body || typeof body.jobId !== "string" || typeof body.paused !== "boolean") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!knownJobIds().has(body.jobId)) {
    return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  }

  if (isCommandCentralLocalRuntime()) {
    const origin = getHostedCommandCentralOrigin();
    const internal = resolveCronStatusInternalKey();
    if (origin && internal) {
      try {
        const r = await fetch(new URL("/api/cron/pause", origin).toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-key": internal,
          },
          body: JSON.stringify({ jobId: body.jobId, paused: body.paused }),
          signal: AbortSignal.timeout(15_000),
        });
        const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (r.ok) {
          return NextResponse.json(data);
        }
        // Hosted build predates /api/cron/pause — persist locally so the Cron tab still reflects the toggle.
        if (r.status === 404) {
          const filePausedIds = setCronJobFilePaused(body.jobId, body.paused);
          return NextResponse.json({
            ok: true,
            jobId: body.jobId,
            paused: body.paused,
            filePausedIds,
            pauseAppliedLocallyOnly: true,
          });
        }
        return NextResponse.json(data, { status: r.status });
      } catch (e) {
        return NextResponse.json(
          {
            error: "hosted_cron_pause_unreachable",
            detail: e instanceof Error ? e.message : String(e),
          },
          { status: 502 }
        );
      }
    }

    return NextResponse.json(
      {
        error: "cron_pause_requires_hosted",
        detail:
          "Set CC_HOSTED_APP_URL and INTERNAL_API_KEY (matching the droplet) to pause production crons from this machine.",
      },
      { status: 503 }
    );
  }

  const filePausedIds = setCronJobFilePaused(body.jobId, body.paused);
  return NextResponse.json({
    ok: true,
    jobId: body.jobId,
    paused: body.paused,
    filePausedIds,
  });
}
