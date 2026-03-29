import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Minimal JSON probe — use to verify the Marni KB API tree is deployed (no DB). */
export async function GET() {
  return NextResponse.json({ ok: true, service: "marni-kb" });
}
