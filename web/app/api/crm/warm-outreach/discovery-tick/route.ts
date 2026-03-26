import { NextRequest, NextResponse } from "next/server";
import {
  forceInsertWarmOutreachDiscoverySlot,
  queryWarmOutreachActiveRows,
  runWarmOutreachDiscoveryTick,
} from "@/lib/warm-outreach-discovery";

/**
 * POST — run the same discovery pass as the Tim cron (Pacific business hours, paced/legacy rules).
 * Optional body `{ "spawnWorkflowId": "<uuid>", "force": true? }` with `x-internal-key: INTERNAL_API_KEY`
 * forces one AWAITING_CONTACT row. Use `"force": true` to bypass paced max-open-slot (still obeys target_cap / backlog).
 *
 * GET — list active warm-outreach workflow ids (for copying into spawnWorkflowId).
 */

export async function GET() {
  const rows = await queryWarmOutreachActiveRows();
  return NextResponse.json({
    count: rows.length,
    workflows: rows.map((r) => ({
      workflowId: r.workflowId,
      packageId: r.packageId,
      packageName: r.packageName,
      packageNumber: r.packageNumber,
    })),
  });
}

export async function POST(req: NextRequest) {
  const internalKey = process.env.INTERNAL_API_KEY?.trim();
  const headerKey = req.headers.get("x-internal-key")?.trim();
  const internalOk = Boolean(internalKey && headerKey === internalKey);

  let body: { spawnWorkflowId?: string; force?: boolean } = {};
  try {
    const j = await req.json();
    if (j && typeof j === "object") body = j as { spawnWorkflowId?: string; force?: boolean };
  } catch {
    /* empty body */
  }

  const wfId =
    typeof body.spawnWorkflowId === "string" ? body.spawnWorkflowId.trim() : "";
  if (wfId) {
    if (!internalOk) {
      return NextResponse.json(
        { ok: false, error: "spawnWorkflowId requires x-internal-key (INTERNAL_API_KEY)" },
        { status: 403 }
      );
    }
    const r = await forceInsertWarmOutreachDiscoverySlot(wfId, {
      ignorePacedOpenCap: body.force === true,
    });
    return NextResponse.json(r.ok ? { ok: true, itemId: r.itemId } : { ok: false, error: r.error });
  }

  const tick = await runWarmOutreachDiscoveryTick();
  return NextResponse.json({
    ok: true,
    spawned: tick.spawned,
    skipped: tick.skipped,
  });
}
