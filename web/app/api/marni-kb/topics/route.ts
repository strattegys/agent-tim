import { NextResponse } from "next/server";
import {
  isMarniKbDatabaseConfigured,
  listKbTopics,
  createKbTopic,
  type KbSourceMode,
} from "@/lib/marni-kb";

function noDb() {
  return NextResponse.json(
    { error: "CRM database not configured. Set CRM_DB_* in web/.env.local and apply migrate-marni-kb.sql." },
    { status: 503 }
  );
}

export async function GET() {
  if (!isMarniKbDatabaseConfigured()) return noDb();
  try {
    const topics = await listKbTopics("marni");
    return NextResponse.json({ topics });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isMarniKbDatabaseConfigured()) return noDb();
  try {
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const queries = Array.isArray(body.queries) ? body.queries.map(String) : [];
    const postUrls = Array.isArray(body.postUrls) ? body.postUrls.map(String) : [];
    const sourceMode = (["web_only", "linkedin_only", "both"] as const).includes(body.sourceMode)
      ? (body.sourceMode as KbSourceMode)
      : "web_only";
    let cadenceMinutes: number | null = null;
    if (body.cadenceMinutes != null && body.cadenceMinutes !== "") {
      const n = Math.floor(Number(body.cadenceMinutes));
      if (Number.isFinite(n)) cadenceMinutes = Math.max(15, Math.min(10080, n));
    }
    const topic = await createKbTopic({
      name,
      description: typeof body.description === "string" ? body.description : null,
      queries,
      postUrls,
      sourceMode,
      cadenceMinutes,
      enabled: body.enabled !== false,
    });
    return NextResponse.json({ topic });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
