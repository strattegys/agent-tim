import { NextResponse } from "next/server";
import {
  isMarniKbDatabaseConfigured,
  getKbTopic,
  updateKbTopic,
  deleteKbTopic,
  type KbSourceMode,
} from "@/lib/marni-kb";

function noDb() {
  return NextResponse.json({ error: "CRM database not configured." }, { status: 503 });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!isMarniKbDatabaseConfigured()) return noDb();
  const { id } = await ctx.params;
  const topic = await getKbTopic(id);
  if (!topic) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ topic });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!isMarniKbDatabaseConfigured()) return noDb();
  const { id } = await ctx.params;
  const body = await req.json();
  const patch: Parameters<typeof updateKbTopic>[1] = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (body.description !== undefined) {
    patch.description = body.description === null ? null : String(body.description);
  }
  if (Array.isArray(body.queries)) patch.queries = body.queries.map(String);
  if (Array.isArray(body.postUrls)) patch.postUrls = body.postUrls.map(String);
  if (["web_only", "linkedin_only", "both"].includes(body.sourceMode)) {
    patch.sourceMode = body.sourceMode as KbSourceMode;
  }
  if (body.cadenceMinutes === null || body.cadenceMinutes === "") {
    patch.cadenceMinutes = null;
  } else if (body.cadenceMinutes != null) {
    const n = Math.floor(Number(body.cadenceMinutes));
    if (Number.isFinite(n)) patch.cadenceMinutes = Math.max(15, Math.min(10080, n));
  }
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  const topic = await updateKbTopic(id, patch);
  if (!topic) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ topic });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!isMarniKbDatabaseConfigured()) return noDb();
  const { id } = await ctx.params;
  const ok = await deleteKbTopic(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
