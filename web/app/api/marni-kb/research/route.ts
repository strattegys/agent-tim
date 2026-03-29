import { NextResponse } from "next/server";
import { isMarniKbDatabaseConfigured, runKbResearch } from "@/lib/marni-kb";

export const runtime = "nodejs";

/** Research = Brave + many Gemini embeds + inserts; allow long runs on serverless hosts. */
export const maxDuration = 300;

function noDb() {
  return NextResponse.json({ error: "CRM database not configured." }, { status: 503 });
}

/**
 * Run research for a topic. Uses a flat path so Next dev reliably resolves the handler
 * (nested `/topics/[id]/run` has been observed to 404 as HTML in `next dev` while production build lists it).
 */
export async function POST(req: Request) {
  if (!isMarniKbDatabaseConfigured()) return noDb();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const topicId =
    typeof body === "object" &&
    body !== null &&
    "topicId" in body &&
    typeof (body as { topicId: unknown }).topicId === "string"
      ? (body as { topicId: string }).topicId.trim()
      : "";
  if (!topicId) {
    return NextResponse.json({ error: "topicId is required" }, { status: 400 });
  }
  try {
    const run = await runKbResearch(topicId);
    return NextResponse.json({ run });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("already in progress") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
