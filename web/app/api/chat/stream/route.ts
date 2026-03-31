import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { chatStream } from "@/lib/gemini";
import { chatStreamAnthropic } from "@/lib/anthropic-chat";
import { chatStreamGroq } from "@/lib/groq-chat";
import { getAgentConfig } from "@/lib/agent-config";
import {
  SESSION_HISTORY_MAX_CAP,
  type ChatStreamExtraOptions,
} from "@/lib/chat-stream-options";
import {
  buildTimContextDebugSnapshot,
  isTimChatContextDebugEnabled,
} from "@/lib/tim-chat-debug";
import {
  buildTimWarmGroqAugmentationText,
  workflowItemExists,
} from "@/lib/tim-warm-groq-context";
import { initCronJobs } from "@/lib/cron";

if (process.env.npm_lifecycle_event !== "build") {
  try {
    initCronJobs();
  } catch (e) {
    console.error("[api/chat/stream] initCronJobs failed:", e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      message,
      agent,
      workQueueContext,
      uiContext,
      sessionHistoryMaxMessages: rawHistoryCap,
      timWorkflowItemId: rawTimWorkflowItemId,
    } = body as {
      message?: string;
      agent?: string;
      workQueueContext?: string;
      uiContext?: string;
      sessionHistoryMaxMessages?: number;
      timWorkflowItemId?: string;
    };
    const agentId = agent || "tim";

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const config = getAgentConfig(agentId);
    const tim = typeof workQueueContext === "string" ? workQueueContext.trim() : "";
    const ui = typeof uiContext === "string" ? uiContext.trim() : "";

    let serverWarmAug = "";
    const wid =
      agentId === "tim" && typeof rawTimWorkflowItemId === "string"
        ? rawTimWorkflowItemId.trim()
        : "";
    if (wid.length >= 20 && wid.length <= 64) {
      const session = await auth();
      if (session) {
        try {
          if (await workflowItemExists(wid)) {
            const aug = await buildTimWarmGroqAugmentationText(wid);
            if (aug) serverWarmAug = aug;
          }
        } catch (e) {
          console.warn("[api/chat/stream] Tim warm Groq augmentation skipped:", e);
        }
      }
    }

    // Do not truncate here: `appendEphemeralContext` caps size. Server warm block adds CRM thread + brief + KB.
    const mergedContext = [tim, ui, serverWarmAug].filter(Boolean).join("\n\n---\n\n");

    let sessionHistoryMaxMessages: number | undefined;
    if (
      typeof rawHistoryCap === "number" &&
      Number.isFinite(rawHistoryCap) &&
      rawHistoryCap > 0
    ) {
      sessionHistoryMaxMessages = Math.min(
        Math.floor(rawHistoryCap),
        SESSION_HISTORY_MAX_CAP
      );
    }

    const extra: ChatStreamExtraOptions | undefined = (() => {
      const e: ChatStreamExtraOptions = {};
      if (mergedContext.length > 0) e.workQueueContext = mergedContext;
      if (sessionHistoryMaxMessages != null) {
        e.sessionHistoryMaxMessages = sessionHistoryMaxMessages;
      }
      return Object.keys(e).length > 0 ? e : undefined;
    })();

    const timContextDebug =
      agentId === "tim" && isTimChatContextDebugEnabled()
        ? buildTimContextDebugSnapshot(tim, ui, serverWarmAug)
        : null;

    const chatFn =
      config.provider === "anthropic" ? chatStreamAnthropic :
      config.provider === "groq" ? chatStreamGroq :
      chatStream;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (timContextDebug) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ timContextDebug })}\n\n`)
            );
          }

          const {
            userMessageIsSendItNow,
            extractWorkflowItemIdFromTimContext,
            markLinkedInSendChatApproved,
          } = await import("@/lib/tim-linkedin-send-chat-gate");
          if (agentId === "tim" && userMessageIsSendItNow(message)) {
            const wid = extractWorkflowItemIdFromTimContext(tim);
            if (wid) {
              const m = await markLinkedInSendChatApproved(wid);
              const reply = m.ok
                ? "Got it — **Send It Now** is recorded for this workflow item. Click **Submit** in the work panel to send the LinkedIn message."
                : m.error || "Could not record approval.";
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: reply })}\n\n`));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              return;
            }
          }

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
