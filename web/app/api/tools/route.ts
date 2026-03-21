import { NextResponse } from "next/server";
import { TOOL_REGISTRY } from "@/lib/tools";
import { AGENT_REGISTRY } from "@/lib/agent-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  // Build a map: toolId → array of agent IDs that use it
  const toolAgentMap: Record<string, string[]> = {};
  for (const [agentId, spec] of Object.entries(AGENT_REGISTRY)) {
    for (const toolId of spec.tools) {
      if (!toolAgentMap[toolId]) toolAgentMap[toolId] = [];
      toolAgentMap[toolId].push(agentId);
    }
  }

  const tools = Object.values(TOOL_REGISTRY).map((t) => ({
    ...t.metadata,
    assignedTo: toolAgentMap[t.metadata.id] || [],
  }));

  return NextResponse.json({ tools });
}
