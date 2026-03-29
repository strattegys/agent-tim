import { NextResponse, type NextRequest } from "next/server";
import { isMarniKbDatabaseConfigured, listKnowledgeChunks } from "@/lib/marni-kb";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isMarniKbDatabaseConfigured()) {
    return NextResponse.json({ error: "CRM database not configured." }, { status: 503 });
  }
  const topicId = req.nextUrl.searchParams.get("topicId") || undefined;
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Math.min(200, Math.max(1, parseInt(limitRaw, 10) || 80)) : 80;
  try {
    const chunks = await listKnowledgeChunks("marni", { topicId, limit });
    return NextResponse.json({ chunks });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
