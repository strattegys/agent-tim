import { NextResponse } from "next/server";
import { isMarniKbDatabaseConfigured, runKbResearch } from "@/lib/marni-kb";

function noDb() {
  return NextResponse.json({ error: "CRM database not configured." }, { status: 503 });
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!isMarniKbDatabaseConfigured()) return noDb();
  try {
    const { id } = await ctx.params;
    const run = await runKbResearch(id);
    return NextResponse.json({ run });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("already in progress") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
