import { NextResponse } from "next/server";
import { runTimHeartbeat, type HeartbeatFinding } from "@/lib/heartbeat";

/**
 * POST /api/heartbeat — Manually trigger Tim's heartbeat for testing.
 * GET  /api/heartbeat — Run heartbeat and return findings without notifying.
 */

export async function POST() {
  try {
    const findings: HeartbeatFinding[] = await runTimHeartbeat();
    return NextResponse.json({
      status: "ok",
      findingsCount: findings.length,
      findings,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ status: "error", error: msg }, { status: 500 });
  }
}
