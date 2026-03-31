import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";
import { runDevTimTestQueueSeed } from "@/lib/dev-tim-test-queue-seed";

export const runtime = "nodejs";

function devSeedAllowed(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.DEV_UNIPILE_INBOUND_REPLAY === "1";
}

/**
 * POST /api/dev/seed-tim-test-queue
 *
 * Inserts deterministic sample rows into Postgres CRM (2 LinkedIn general-inbox + 1 warm MESSAGE_DRAFT).
 * Same availability as replay-unipile-inbound: development, or DEV_UNIPILE_INBOUND_REPLAY=1.
 *
 * Body (JSON, optional): `{ force?: boolean }` — replace prior seed rows when true.
 */
export async function POST(req: NextRequest) {
  if (!devSeedAllowed()) {
    return NextResponse.json(
      { error: "Not available (enable development or DEV_UNIPILE_INBOUND_REPLAY=1)" },
      { status: 404 }
    );
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let force = false;
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = (await req.json()) as Record<string, unknown>;
      force = body.force === true;
    }
  } catch {
    /* defaults */
  }

  const result = await runDevTimTestQueueSeed({ force });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  if (!result.alreadySeeded) {
    notifyDashboardSyncChange();
  }

  return NextResponse.json({
    ok: true,
    alreadySeeded: Boolean(result.alreadySeeded),
    message: result.message,
    ...(result.alreadySeeded
      ? {}
      : {
          giWorkflowId: result.giWorkflowId,
          warmWorkflowId: result.warmWorkflowId,
          warmItemId: result.warmItemId,
        }),
  });
}
