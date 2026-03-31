import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  observabilityApiAllowed,
  OBSERVABILITY_API_DISABLED_ERROR,
} from "@/lib/observability-gate";
import {
  clearEdgeApiRequests,
  getEdgeApiRequests,
} from "@/lib/observability-edge-http";

export const runtime = "edge";

/**
 * GET ?limit=200 — /api requests recorded in Edge middleware (method + pathname only).
 * POST { "action": "clear" } — empty the buffer.
 */
export async function GET(req: NextRequest) {
  if (!observabilityApiAllowed()) {
    return NextResponse.json(
      { error: OBSERVABILITY_API_DISABLED_ERROR },
      { status: 404 }
    );
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : 200;
  const entries = getEdgeApiRequests(Number.isFinite(limit) ? limit : 200);

  return NextResponse.json({
    category: "http_middleware",
    hint:
      "Captured in Edge middleware (pathname only, no status). If this stays empty while traffic runs, your runtime may isolate Edge from this route.",
    entries,
  });
}

export async function POST(req: NextRequest) {
  if (!observabilityApiAllowed()) {
    return NextResponse.json(
      { error: OBSERVABILITY_API_DISABLED_ERROR },
      { status: 404 }
    );
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action !== "clear") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  clearEdgeApiRequests();
  return NextResponse.json({ ok: true });
}
