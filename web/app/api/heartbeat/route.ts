import { NextResponse } from "next/server";
import { runTimHeartbeat, type HeartbeatFinding } from "@/lib/heartbeat";

/**
 * POST /api/heartbeat — Manually trigger Tim's heartbeat.
 *
 * Query params:
 *   ?mode=detect     — Return warm-outreach findings only; no bell writes or Scout flush
 *   ?mode=autonomous — Default: warm-outreach bell notifications + Scout delegation bell (no LLM)
 */

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") || "autonomous";
    const detectOnly = mode === "detect";

    const findings: HeartbeatFinding[] = await runTimHeartbeat(detectOnly);
    return NextResponse.json({
      status: "ok",
      mode,
      findingsCount: findings.length,
      findings,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ status: "error", error: msg }, { status: 500 });
  }
}
