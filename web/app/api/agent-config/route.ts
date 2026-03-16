import { NextRequest, NextResponse } from "next/server";
import { getAgentConfig } from "@/lib/agent-config";
import { APPROVAL_PHRASES } from "@/lib/tools";

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agent") || "tim";
  const config = getAgentConfig(agentId);
  return NextResponse.json({ config, approvalPhrases: APPROVAL_PHRASES });
}
