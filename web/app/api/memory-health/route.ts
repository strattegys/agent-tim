import { NextRequest, NextResponse } from "next/server";
import { AGENT_REGISTRY } from "@/lib/agent-registry";
import { checkMemoryHealth } from "@/lib/memory-health";

export async function GET(req: NextRequest) {
  const agentId = (req.nextUrl.searchParams.get("agent") || "").trim().toLowerCase();
  if (!agentId) {
    return NextResponse.json({ error: "Missing agent query parameter" }, { status: 400 });
  }
  if (!AGENT_REGISTRY[agentId]) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  }

  try {
    const result = await checkMemoryHealth(agentId);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "Memory health check failed", detail: message },
      { status: 500 }
    );
  }
}
