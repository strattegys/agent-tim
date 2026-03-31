import { NextResponse, type NextRequest } from "next/server";
import { isMarniKbDatabaseConfigured, getKbTopic, listKbRuns } from "@/lib/marni-kb";
import { resolveKbStudioAgentId } from "@/lib/kb-studio";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isMarniKbDatabaseConfigured()) {
    return NextResponse.json({ error: "CRM database not configured." }, { status: 503 });
  }
  const topicId = req.nextUrl.searchParams.get("topicId");
  if (!topicId) {
    return NextResponse.json({ error: "topicId query param required" }, { status: 400 });
  }
  const agentRaw = req.nextUrl.searchParams.get("agentId");
  if (agentRaw != null && agentRaw !== "") {
    const resolved = resolveKbStudioAgentId(agentRaw);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    const topic = await getKbTopic(topicId);
    if (!topic || topic.agentId !== resolved.agentId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }
  try {
    const runs = await listKbRuns(topicId, 50);
    return NextResponse.json({ runs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
