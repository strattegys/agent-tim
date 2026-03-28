import { NextRequest, NextResponse } from "next/server";
import { fetchDashboardSyncPayload } from "@/lib/dashboard-sync-server";

export const runtime = "nodejs";

/**
 * One browser round-trip for CRM task badge counts + nanobot notifications.
 * Server fans out in parallel (still multiple DB hits; avoids duplicate client polls).
 * Prefer SSE (/api/dashboard-stream) for live updates; this route remains for imperative refresh.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const cookie = req.headers.get("cookie") ?? "";
  const body = await fetchDashboardSyncPayload(origin, cookie);
  return NextResponse.json(body);
}
