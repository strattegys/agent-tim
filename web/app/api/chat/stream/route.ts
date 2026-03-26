import { type NextRequest } from "next/server";
import { chatStream } from "@/lib/gemini";
import { chatStreamAnthropic } from "@/lib/anthropic-chat";
import { chatStreamGroq } from "@/lib/groq-chat";
import { getAgentConfig } from "@/lib/agent-config";
import type { ChatStreamExtraOptions } from "@/lib/chat-stream-options";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, agent, workQueueContext } = body as {
      message?: string;
      agent?: string;
      workQueueContext?: string;
    };
    const agentId = agent || "tim";

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const config = getAgentConfig(agentId);
    const extra: ChatStreamExtraOptions | undefined =
      typeof workQueueContext === "string" && workQueueContext.trim()
        ? { workQueueContext: workQueueContext.trim().slice(0, 12000) }
        : undefined;

    const chatFn =
      config.provider === "anthropic" ? chatStreamAnthropic :
      config.provider === "groq" ? chatStreamGroq :
      chatStream;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await chatFn(agentId, message, (chunk) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
          }, extra);
          if (result.delegatedFrom) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delegatedFrom: result.delegatedFrom })}\n\n`));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Internal error";
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
