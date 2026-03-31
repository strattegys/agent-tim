import { NextResponse, type NextRequest } from "next/server";
import { getHistory } from "@/lib/session-store";
import { getAgentConfig } from "@/lib/agent-config";

export const runtime = "nodejs";

/** Session history for the sidebar. Chat turns use POST `/api/chat/stream` only. */
export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agent") || "tim";
  const config = getAgentConfig(agentId);
  const history = getHistory(config.sessionFile);
  return NextResponse.json(
    { history },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      },
    }
  );
}
