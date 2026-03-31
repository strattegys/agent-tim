import { getObservabilityToggleEffective } from "@/lib/observability-runtime";
import { pushGroqObservabilityLog } from "@/lib/observability-log-buffer";

/**
 * Verbose Groq request/response logging for local debugging (Tim reply quality, tool args, etc.).
 * Enable with GROQ_CHAT_DEBUG=1 in web/.env.local, or toggle from Tim lab / Observation Post.
 *
 * **Session mode:** `chatStreamGroq` / `autonomousChatGroq` pass `sessionLines`; each log appends to that
 * array and a **single** ring-buffer entry is flushed in `finally` (`[groq-debug-session]`) so the Tim lab
 * shows one card per user message with the full trace inside the modal.
 */

const PER_MESSAGE_MAX = 14_000;
const TOOL_ARGS_MAX = 10_000;
const ERROR_BODY_MAX = 8_000;
const MAX_SESSION_BODY_CHARS = 900_000;

export type GroqDebugIteration = number | string;

export interface GroqDebugContext {
  agentId: string;
  iteration: GroqDebugIteration;
  /**
   * When set (same array for the whole chat request), lines are appended here instead of pushing
   * separate ring-buffer entries. Caller must call `flushGroqObservabilitySession` when done.
   */
  sessionLines?: string[];
}

export function isGroqChatDebugEnabled(): boolean {
  return getObservabilityToggleEffective("GROQ_CHAT_DEBUG");
}

/** Append one debug block to session or push immediately to the ring buffer. */
function groqEmitDebugBlock(line1: string, line2: string | undefined, sessionLines: string[] | undefined): void {
  if (line2 !== undefined) {
    console.log(line1);
    console.log(line2);
    const block = `${line1}\n${line2}`;
    if (sessionLines) sessionLines.push(block);
    else pushGroqObservabilityLog(block);
  } else {
    console.log(line1);
    if (sessionLines) sessionLines.push(line1);
    else pushGroqObservabilityLog(line1);
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

export type GroqDebugSessionFlush = {
  agentId: string;
  startedAt: number;
  groqApiCalls: number;
  userMessagePreview: string;
  lines: string[];
};

/**
 * One Tim lab / Observation Post card per chat turn — full trace in `lines` joined below the JSON header.
 */
export function flushGroqObservabilitySession(opts: GroqDebugSessionFlush): void {
  if (!isGroqChatDebugEnabled()) return;
  if (opts.lines.length === 0) return;

  const header = {
    type: "groq-debug-session" as const,
    agentId: opts.agentId,
    startedAt: new Date(opts.startedAt).toISOString(),
    groqApiCalls: opts.groqApiCalls,
    userPreview: opts.userMessagePreview.replace(/\s+/g, " ").trim().slice(0, 220),
  };

  let body = opts.lines.join("\n\n────────────────────────────────────────\n\n");
  const rawLen = body.length;
  if (body.length > MAX_SESSION_BODY_CHARS) {
    body =
      body.slice(0, MAX_SESSION_BODY_CHARS) +
      `\n\n… [session body truncated at ${MAX_SESSION_BODY_CHARS} chars; original ${rawLen} chars]`;
  }

  const full = `[groq-debug-session]\n${JSON.stringify(header)}\n\n${body}`;
  pushGroqObservabilityLog(full);
}

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

  groqEmitDebugBlock(
    `[groq-debug] ─── request → Groq (${meta.agentId} iter=${meta.iteration}) ───`,
    JSON.stringify(payload, null, 2),
    meta.sessionLines
  );
}

function summarizeToolCallsInMessage(tc: unknown): string[] | undefined {
  if (!Array.isArray(tc)) return undefined;
  return tc.map((x) => {
    const o = x as { function?: { name?: string } };
    return o.function?.name ?? "?";
  });
}

/** Raw assistant message from Groq (before mergeRecoveredToolCalls). */
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
  groqEmitDebugBlock(
    `[groq-debug] ─── raw choice ← Groq (${meta.agentId} iter=${meta.iteration}) ───`,
    JSON.stringify(payload, null, 2),
    meta.sessionLines
  );
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
  groqEmitDebugBlock(
    `[groq-debug] ─── merged ← Groq (${meta.agentId} iter=${meta.iteration}) ───`,
    JSON.stringify(payload, null, 2),
    meta.sessionLines
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
  groqEmitDebugBlock(head, detail, meta.sessionLines);
}

export function logGroqToolExecution(
  meta: GroqDebugContext,
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
  groqEmitDebugBlock(
    `[groq-debug] ─── tool_result (${meta.agentId} iter=${meta.iteration}) ${toolName} ───`,
    block,
    meta.sessionLines
  );
}
