import { getObservabilityToggleEffective } from "@/lib/observability-runtime";
import { pushGroqObservabilityLog } from "@/lib/observability-log-buffer";

/**
 * Verbose Groq request/response logging for local debugging (Tim reply quality, tool args, etc.).
 * Enable with GROQ_CHAT_DEBUG=1 in web/.env.local, or toggle from Friday → Observation Post (in-process override).
 *
 * Where to read logs:
 * - **Docker dev** (COMMAND-CENTRAL, docker-compose.dev.yml): from repo root,
 *   `docker compose -f docker-compose.dev.yml logs -f web`
 *   or `docker logs -f cc-localdev-p3010`
 * - **Docker Desktop:** open the **web** container → **Logs**.
 * - **Production compose:** `docker compose logs -f web` (path depends on your deploy).
 *
 * Search for the prefix `[groq-debug]`. May include CRM/thread text; do not enable on shared production hosts.
 */

const PER_MESSAGE_MAX = 14_000;
const TOOL_ARGS_MAX = 10_000;
const ERROR_BODY_MAX = 8_000;

export type GroqDebugIteration = number | string;

export interface GroqDebugContext {
  agentId: string;
  iteration: GroqDebugIteration;
}

export function isGroqChatDebugEnabled(): boolean {
  return getObservabilityToggleEffective("GROQ_CHAT_DEBUG");
}

function groqLogLine1(line1: string, line2?: string): void {
  if (line2 !== undefined) {
    console.log(line1);
    console.log(line2);
    pushGroqObservabilityLog(`${line1}\n${line2}`);
  } else {
    console.log(line1);
    pushGroqObservabilityLog(line1);
  }
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… [+${s.length - max} chars truncated for log]`;
}

type LogMessage = {
  role: string;
  content: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
};

/** What we send to api.groq.com/openai/v1/chat/completions (messages + tool names). */
export function logGroqChatOutbound(
  meta: GroqDebugContext & { model: string },
  messages: LogMessage[],
  toolDeclarationNames: string[] | undefined
): void {
  if (!isGroqChatDebugEnabled()) return;

  const payload = {
    phase: "outbound",
    agentId: meta.agentId,
    iteration: meta.iteration,
    model: meta.model,
    messageCount: messages.length,
    toolDeclarationCount: toolDeclarationNames?.length ?? 0,
    toolDeclarationNames,
    messages: messages.map((m, idx) => ({
      idx,
      role: m.role,
      tool_call_id: m.tool_call_id,
      contentChars: m.content?.length ?? 0,
      content: m.content != null ? clip(m.content, PER_MESSAGE_MAX) : null,
      toolCallsSummary: summarizeToolCallsInMessage(m.tool_calls),
    })),
  };

  groqLogLine1(
    `[groq-debug] ─── request → Groq (${meta.agentId} iter=${meta.iteration}) ───`,
    JSON.stringify(payload, null, 2)
  );
}

function summarizeToolCallsInMessage(tc: unknown): string[] | undefined {
  if (!Array.isArray(tc)) return undefined;
  return tc.map((x) => {
    const o = x as { function?: { name?: string } };
    return o.function?.name ?? "?";
  });
}

/** Raw assistant message from Groq (before mergeRecoveredToolCalls) — optional. */
export function logGroqChatRawChoice(
  meta: GroqDebugContext & { model: string },
  content: string,
  tool_calls: Array<{ function: { name: string; arguments: string } }> | undefined
): void {
  if (!isGroqChatDebugEnabled()) return;
  const payload = {
    phase: "raw_choice",
    agentId: meta.agentId,
    iteration: meta.iteration,
    model: meta.model,
    contentChars: content.length,
    content: clip(content, PER_MESSAGE_MAX),
    tool_calls: tool_calls?.map((t) => ({
      name: t.function.name,
      argsChars: t.function.arguments?.length ?? 0,
      arguments: clip(t.function.arguments || "", TOOL_ARGS_MAX),
    })),
  };
  console.log(`[groq-debug] ─── raw choice ← Groq (${meta.agentId} iter=${meta.iteration}) ───`);
  console.log(JSON.stringify(payload, null, 2));
}

/** After mergeRecoveredToolCalls — what we actually execute / stream from. */
export function logGroqChatMergedResponse(
  meta: GroqDebugContext & { model: string },
  data: {
    content: string;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  }
): void {
  if (!isGroqChatDebugEnabled()) return;
  const payload = {
    phase: "merged_response",
    agentId: meta.agentId,
    iteration: meta.iteration,
    model: meta.model,
    contentChars: data.content.length,
    content: clip(data.content, PER_MESSAGE_MAX),
    tool_calls: data.tool_calls?.map((t) => ({
      id: t.id,
      name: t.function.name,
      argsChars: t.function.arguments?.length ?? 0,
      arguments: clip(t.function.arguments || "", TOOL_ARGS_MAX),
    })),
    usage: data.usage,
  };
  groqLogLine1(
    `[groq-debug] ─── merged ← Groq (${meta.agentId} iter=${meta.iteration}) ───`,
    JSON.stringify(payload, null, 2)
  );
}

export function logGroqChatHttpError(
  meta: GroqDebugContext & { model: string },
  status: number,
  body: string
): void {
  if (!isGroqChatDebugEnabled()) return;
  const head = `[groq-debug] ─── HTTP ${status} (${meta.agentId} iter=${meta.iteration}) ───`;
  const detail = clip(body, ERROR_BODY_MAX);
  console.log(head, detail);
  pushGroqObservabilityLog(`${head}\n${detail}`);
}

export function logGroqToolExecution(
  meta: GroqDebugContext & { iteration: GroqDebugIteration },
  toolName: string,
  execArgs: Record<string, string>,
  result: string
): void {
  if (!isGroqChatDebugEnabled()) return;
  const block = JSON.stringify(
    {
      execArgs,
      resultChars: result.length,
      result: clip(result, PER_MESSAGE_MAX),
    },
    null,
    2
  );
  groqLogLine1(
    `[groq-debug] ─── tool_result (${meta.agentId} iter=${meta.iteration}) ${toolName} ───`,
    block
  );
}
