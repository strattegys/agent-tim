import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

import {
  isMarniKbDatabaseConfigured,
  getKbTopic,
  updateKbTopic,
  deleteKbTopic,
  type KbSourceMode,
} from "@/lib/marni-kb";
import { resolveKbStudioAgentId } from "@/lib/kb-studio";

function noDb() {
  return NextResponse.json({ error: "CRM database not configured." }, { status: 503 });
}

async function topicForRequest(
  id: string,
  agentIdParam: string | null
): Promise<
  | { ok: true; topic: NonNullable<Awaited<ReturnType<typeof getKbTopic>>> }
  | { ok: false; status: number; body: { error: string } }
> {
  const topic = await getKbTopic(id);
  if (!topic) return { ok: false, status: 404, body: { error: "Not found" } };
  if (agentIdParam != null && agentIdParam !== "") {
    const resolved = resolveKbStudioAgentId(agentIdParam);
    if (!resolved.ok) {
      return { ok: false, status: 400, body: { error: resolved.error } };
    }
    if (topic.agentId !== resolved.agentId) {
      return { ok: false, status: 404, body: { error: "Not found" } };
    }
  }
  return { ok: true, topic };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!isMarniKbDatabaseConfigured()) return noDb();
  const { id } = await ctx.params;
  const gate = await topicForRequest(id, req.nextUrl.searchParams.get("agentId"));
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  return NextResponse.json({ topic: gate.topic });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!isMarniKbDatabaseConfigured()) return noDb();
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const gate = await topicForRequest(
    id,
    typeof body.agentId === "string" ? body.agentId : null
  );
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  const patch: Parameters<typeof updateKbTopic>[1] = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (body.description !== undefined) {
    patch.description = body.description === null ? null : String(body.description);
  }
  if (Array.isArray(body.queries)) patch.queries = body.queries.map(String);
  if (Array.isArray(body.postUrls)) patch.postUrls = body.postUrls.map(String);
  if (
    typeof body.sourceMode === "string" &&
    (["web_only", "linkedin_only", "both"] as const).includes(body.sourceMode as KbSourceMode)
  ) {
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
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!isMarniKbDatabaseConfigured()) return noDb();
  const { id } = await ctx.params;
  const gate = await topicForRequest(id, req.nextUrl.searchParams.get("agentId"));
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  if (gate.topic.topicKind === "crm_mirror") {
    return NextResponse.json(
      { error: "The CRM & LinkedIn corpus topic cannot be deleted." },
      { status: 400 }
    );
  }
  const ok = await deleteKbTopic(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
