import { NextResponse } from "next/server";
import {
  isMarniKbDatabaseConfigured,
  getKbTopic,
  runKbResearch,
} from "@/lib/marni-kb";
import { resolveKbStudioAgentId } from "@/lib/kb-studio";

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
  const b = body as Record<string, unknown>;
  const topicId =
    typeof body === "object" && body !== null && typeof b.topicId === "string"
      ? b.topicId.trim()
      : "";
  if (!topicId) {
    return NextResponse.json({ error: "topicId is required" }, { status: 400 });
  }
  if (typeof b.agentId === "string" && b.agentId.trim() !== "") {
    const resolved = resolveKbStudioAgentId(b.agentId);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    const topic = await getKbTopic(topicId);
    if (!topic || topic.agentId !== resolved.agentId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
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
