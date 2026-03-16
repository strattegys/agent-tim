import { NextResponse, type NextRequest } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { getAgentConfig } from "@/lib/agent-config";

export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agent") || "tim";
  const config = getAgentConfig(agentId);

  try {
    const content = readFileSync(config.systemPromptFile, "utf-8");
    return NextResponse.json({ prompt: content, file: config.systemPromptFile });
  } catch {
    return NextResponse.json(
      { error: "Could not read system prompt" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { agent, prompt } = await request.json();
    const agentId = agent || "tim";
    const config = getAgentConfig(agentId);

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Prompt content is required" },
        { status: 400 }
      );
    }

    writeFileSync(config.systemPromptFile, prompt, "utf-8");

    // Clear the cached prompt so the next chat uses the updated version
    const { clearPromptCache } = await import("@/lib/system-prompt");
    clearPromptCache(config.systemPromptFile);

    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to save";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
