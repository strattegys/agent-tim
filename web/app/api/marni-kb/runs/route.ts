import { NextResponse, type NextRequest } from "next/server";
import { isMarniKbDatabaseConfigured, listKbRuns } from "@/lib/marni-kb";

export async function GET(req: NextRequest) {
  if (!isMarniKbDatabaseConfigured()) {
    return NextResponse.json({ error: "CRM database not configured." }, { status: 503 });
  }
  const topicId = req.nextUrl.searchParams.get("topicId");
  if (!topicId) {
    return NextResponse.json({ error: "topicId query param required" }, { status: 400 });
  }
  try {
    const runs = await listKbRuns(topicId, 50);
    return NextResponse.json({ runs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
