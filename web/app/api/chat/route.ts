import { NextResponse, type NextRequest } from "next/server";
import { chat } from "@/lib/gemini";
import { getHistory } from "@/lib/session-store";
import { getAgentConfig } from "@/lib/agent-config";

export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agent") || "tim";
  const config = getAgentConfig(agentId);
  const history = getHistory(config.sessionFile);
  return NextResponse.json({ history });
}

export async function POST(request: Request) {
  try {
    const { message, agent } = await request.json();
    const agentId = agent || "tim";

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const reply = await chat(agentId, message);
    return NextResponse.json({ reply });
  } catch (error: unknown) {
    console.error("Chat error:", error);
    const msg = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
