/**
 * Groq chat provider — OpenAI-compatible API with fast inference.
 * Supports tool calling via local tool calling pattern.
 */

import { getSystemPrompt } from "./system-prompt";
import { toolDeclarations, executeTool, TOOL_REGISTRY } from "./tools";
import { parseGroqToolArgumentsJson } from "./tool-args-normalize";
import { getHistory, addMessage, type ChatMessage } from "./session-store";
import { getAgentConfig, isChatEphemeralAgent } from "./agent-config";
import { consolidateSession } from "./memory";
import type { ChatStreamResult } from "./gemini";
import {
  appendEphemeralContext,
  applySessionHistoryLimit,
  type ChatStreamExtraOptions,
} from "./chat-stream-options";
import { logCommandCentralLlmUsage } from "./llm-usage-log";
import { inferWorkflowItemsCommandFromArgs } from "./tools/workflow-items";
import type { GroqDebugContext } from "./groq-debug-log";
import {
  logGroqChatHttpError,
  logGroqChatMergedResponse,
  logGroqChatOutbound,
  logGroqChatRawChoice,
  logGroqToolExecution,
} from "./groq-debug-log";

const MAX_TOOL_ITERATIONS = 20;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
/** Fallback when agent has no modelName; align with GROQ_CHAT_MODEL in dev. */
const DEFAULT_MODEL =
  process.env.GROQ_CHAT_MODEL?.trim() || "openai/gpt-oss-120b";

/** Strip grounding suffix before matching punch_list tool text. */
function stripToolGroundingSuffix(s: string): string {
  const idx = s.indexOf("\n\n[Assistant reply rule:");
  return (idx >= 0 ? s.slice(0, idx) : s).trim();
}

/**
 * Short user-facing reply for simple punch_list outcomes — skips a second LLM round (faster, less jargon).
 */
function tryPunchListFastUserReply(toolResultsThisRound: string[]): string | null {
  if (toolResultsThisRound.length !== 1) return null;
  const raw = stripToolGroundingSuffix(toolResultsThisRound[0]);
  if (!raw || raw.length > 450) return null;
  if (/^error:/i.test(raw)) return null;
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length > 6) return null;

  const updated = raw.match(/^Updated punch list #(\d+): (.+)\.$/);
  if (updated) {
    const detail =
      updated[2].length > 120 ? `${updated[2].slice(0, 117)}…` : updated[2];
    return `Done — #${updated[1]}: ${detail}`;
  }

  const done = raw.match(/^Punch list item #(\d+)(?: "([^"]+)")? marked done\.$/);
  if (done) return `Done — #${done[1]} is checked off.`;

  const created = raw.match(
    /^Punch list item created: #(\d+) "([^"]+)" \[[^\]]+\]/
  );
  if (created) return `Added #${created[1]} to the punch list.`;

  const archivedN = raw.match(/^Archived (\d+) completed items\.$/);
  if (archivedN) return `Archived ${archivedN[1]} completed items.`;

  const reopened = raw.match(/^Punch list item #(\d+) reopened\.$/);
  if (reopened) return `Reopened #${reopened[1]}.`;

  const archivedOne = raw.match(/^Punch list item #(\d+) archived\.$/);
  if (archivedOne) return `Archived #${archivedOne[1]}.`;

  const noteAdded = raw.match(/^Note added to punch list item #(\d+)\.$/);
  if (noteAdded) {
    return `Saved a journal note (Notes section) on #${noteAdded[1]}.`;
  }

  const subAdded = raw.match(/^Subtask added to punch list #(\d+)\. action_id=/);
  if (subAdded) {
    return `Added an action item (Actions checkboxes) on #${subAdded[1]}.`;
  }

  const subTog = raw.match(/^Subtask on punch list #(\d+) marked (done|open)\.$/);
  if (subTog) {
    return subTog[2] === "done"
      ? `Checked off a subtask on #${subTog[1]}.`
      : `Reopened a subtask on #${subTog[1]}.`;
  }

  if (
    lines.length > 1 &&
    lines.every((l) => /^Punch list item #\d+ marked done\.$/.test(l))
  ) {
    const nums = lines.map((l) => l.match(/^Punch list item #(\d+)/)![1]);
    return `Marked done: ${nums.map((n) => `#${n}`).join(", ")}.`;
  }

  return null;
}

// ── Types (OpenAI-compatible) ──

interface GroqUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

function logGroqUsage(
  agentId: string,
  model: string,
  usage: GroqUsage | undefined
): void {
  if (!usage) return;
  logCommandCentralLlmUsage({
    provider: "groq",
    model,
    agentId,
    inputTokens: usage.prompt_tokens ?? null,
    outputTokens: usage.completion_tokens ?? null,
  });
}

interface GroqMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: GroqToolCall[];
  tool_call_id?: string;
}

interface GroqToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

interface GroqTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

/**
 * Llama on Groq often emits pseudo-tool syntax instead of structured tool_calls, e.g.
 * `<function=workflow_items.get-workflow-artifact({"item_id":"…","stage":"CAMPAIGN_SPEC"})>`
 * which would otherwise be shown as plain chat and never execute.
 */

/** From s[start] === '{', match the closing '}' of that object; ignore { } inside JSON strings. */
function extractBalancedJsonObject(
  s: string,
  start: number
): { json: string; end: number } | null {
  if (s[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { json: s.slice(start, i + 1), end: i + 1 };
    }
  }
  return null;
}

/** From s[start] === '[', match the closing ']' of that array; respects strings. */
function extractBalancedJsonArray(
  s: string,
  start: number
): { json: string; end: number } | null {
  if (s[start] !== "[") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return { json: s.slice(start, i + 1), end: i + 1 };
    }
  }
  return null;
}

/** Parse JSON object/array from raw text, markdown fence, or first balanced [...] / {...} in prose. */
function tryParseEmbeddedJsonPayload(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const tryParse = (s: string): unknown | null => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  let p = tryParse(trimmed);
  if (p !== null) return p;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    p = tryParse(fence[1]!.trim());
    if (p !== null) return p;
  }

  const arrIdx = trimmed.indexOf("[");
  if (arrIdx >= 0) {
    const bal = extractBalancedJsonArray(trimmed, arrIdx);
    if (bal) {
      p = tryParse(bal.json);
      if (p !== null) return p;
    }
  }

  const objIdx = trimmed.indexOf("{");
  if (objIdx >= 0) {
    const bal = extractBalancedJsonObject(trimmed, objIdx);
    if (bal) {
      p = tryParse(bal.json);
      if (p !== null) return p;
    }
  }

  return null;
}

function extractParenJsonFunctionCall(
  text: string
): { qualifiedName: string; argsJson: string } | null {
  const t = text.trim();
  if (!t.startsWith("<function=")) return null;
  const afterTag = t.slice("<function=".length);
  const openParen = afterTag.indexOf("(");
  if (openParen < 0) return null;
  const qualifiedName = afterTag.slice(0, openParen).trim();
  let i = openParen + 1;
  while (i < afterTag.length && /\s/.test(afterTag[i]!)) i++;
  if (afterTag[i] !== "{") return null;
  const balanced = extractBalancedJsonObject(afterTag, i);
  if (!balanced) return null;
  const jsonStr = balanced.json;
  let j = balanced.end;
  while (j < afterTag.length && /\s/.test(afterTag[j]!)) j++;
  if (afterTag[j] === ")") {
    j++;
    while (j < afterTag.length && /\s/.test(afterTag[j]!)) j++;
  }
  if (j < afterTag.length && afterTag[j] === ">") {
    return { qualifiedName, argsJson: jsonStr };
  }
  const rest = afterTag.slice(j).trimStart();
  if (/^(\}\s*)?<\/function>/i.test(rest) || rest === "" || rest.startsWith("}")) {
    return { qualifiedName, argsJson: jsonStr };
  }
  return null;
}

/** `<function=name{...}>` (no parentheses around JSON). */
function extractBraceOnlyFunctionCall(
  text: string
): { qualifiedName: string; argsJson: string } | null {
  const t = text.trim();
  if (!t.startsWith("<function=")) return null;
  const after = t.slice("<function=".length);
  const braceIdx = after.indexOf("{");
  if (braceIdx < 0) return null;
  const qualifiedName = after.slice(0, braceIdx).trim();
  const balanced = extractBalancedJsonObject(after, braceIdx);
  if (!balanced) return null;
  const jsonStr = balanced.json;
  let j = balanced.end;
  while (j < after.length && /\s/.test(after[j]!)) j++;
  if (j < after.length && after[j] === ">") {
    return { qualifiedName, argsJson: jsonStr };
  }
  const rest = after.slice(j).trimStart();
  if (/^<\/function>/i.test(rest)) return { qualifiedName, argsJson: jsonStr };
  return null;
}

/**
 * When the model puts markdown with unescaped " in `artifact`, JSON.parse fails.
 * Find `"artifact": "` … closing `"\}\}</function>` or `"\)\s*>` by end anchor (not by JSON rules).
 */
function tryLooseRecoverWorkflowItemsUpdate(slice: string): GroqToolCall | null {
  if (!/workflow_items\.update-workflow-artifact/i.test(slice)) return null;
  const itemId = slice.match(/"item_id"\s*:\s*"([a-f0-9-]{36})"/i)?.[1];
  const stage = slice.match(/"stage"\s*:\s*"([^"]+)"/)?.[1];
  if (!itemId || !stage) return null;
  const head = slice.match(/"artifact"\s*:\s*"/);
  if (!head || head.index === undefined) return null;
  const valueStart = head.index + head[0].length;

  const fnIdx = slice.search(/<\/function>/i);
  const beforeFn = (fnIdx >= 0 ? slice.slice(0, fnIdx) : slice).trimEnd();

  const close =
    beforeFn.match(/("\s*\}\s*\)\s*>)\s*$/) ||
    beforeFn.match(/("\s*\}\s*\}\s*)\s*$/);
  if (!close || close.index === undefined || close.index <= valueStart) return null;

  const artifact = beforeFn.slice(valueStart, close.index);
  if (!artifact.length) return null;

  const normalized = workflowItemsArgsFromMalformed("workflow_items.update-workflow-artifact", {
    item_id: itemId,
    stage: stage.trim(),
    artifact,
  });
  if (!normalized) return null;
  return {
    id: `recovered-loose-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type: "function",
    function: {
      name: "workflow_items",
      arguments: JSON.stringify(normalized),
    },
  };
}

function workflowItemsArgsFromMalformed(
  qualifiedName: string,
  obj: Record<string, unknown>
): Record<string, string> | null {
  const qn = qualifiedName.trim();
  let command = "";
  if (qn.startsWith("workflow_items.")) {
    command = qn.slice("workflow_items.".length);
  } else if (qn === "workflow_items") {
    command = inferWorkflowItemsCommandFromArgs({
      command: typeof obj.command === "string" ? obj.command : undefined,
      arg1: obj.arg1 != null ? String(obj.arg1) : undefined,
      arg2: obj.arg2 != null ? String(obj.arg2) : undefined,
      arg3:
        obj.arg3 != null
          ? typeof obj.arg3 === "string"
            ? obj.arg3
            : JSON.stringify(obj.arg3)
          : undefined,
    });
    if (!command) return null;
  } else {
    return null;
  }

  const arg1Raw =
    obj.arg1 ?? obj.item_id ?? obj.workflowItemId ?? obj.workflow_item_id ?? obj.itemId;
  const arg2Raw = obj.arg2 ?? obj.stage ?? obj.newStage;
  const arg3Raw =
    obj.arg3 ??
    obj.artifact ??
    obj.content ??
    obj.markdown ??
    obj.body ??
    obj.text ??
    obj.new_content;

  const out: Record<string, string> = { command };
  if (arg1Raw != null) out.arg1 = String(arg1Raw).trim();
  if (arg2Raw != null) out.arg2 = String(arg2Raw).trim();
  if (arg3Raw != null)
    out.arg3 = typeof arg3Raw === "string" ? arg3Raw : JSON.stringify(arg3Raw);
  if (obj.arg4 != null) out.arg4 = String(obj.arg4);
  if (obj.arg5 != null) out.arg5 = String(obj.arg5);

  if (
    (command === "get-workflow-artifact" || command === "update-workflow-artifact") &&
    (!out.arg1 || !out.arg2)
  ) {
    return null;
  }
  if (command === "update-workflow-artifact" && !out.arg3) return null;

  return out;
}

function buildWorkflowItemsRecoveredCall(
  qualifiedName: string,
  obj: Record<string, unknown>
): GroqToolCall | null {
  const normalized = workflowItemsArgsFromMalformed(qualifiedName, obj);
  if (!normalized) return null;
  return {
    id: `recovered-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type: "function",
    function: {
      name: "workflow_items",
      arguments: JSON.stringify(normalized),
    },
  };
}

function tryRecoverToolCallsFromTextContent(content: string): GroqToolCall[] {
  const idx = content.indexOf("<function=");
  if (idx < 0) return [];
  const slice = content.slice(idx).trimStart();

  const parsed =
    extractParenJsonFunctionCall(slice) || extractBraceOnlyFunctionCall(slice);

  if (parsed) {
    const qn = parsed.qualifiedName;
    if (qn === "workflow_items" || qn.startsWith("workflow_items.")) {
      try {
        const obj = JSON.parse(parsed.argsJson) as Record<string, unknown>;
        const tc = buildWorkflowItemsRecoveredCall(qn, obj);
        if (tc) return [tc];
      } catch {
        /* e.g. unescaped " inside artifact string — try loose extractor */
      }
    }
  }

  const loose = tryLooseRecoverWorkflowItemsUpdate(slice);
  return loose ? [loose] : [];
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function normalizeToolNameForRegistry(name: string): string {
  return name.trim().replace(/-/g, "_");
}

/**
 * Llama often returns a JSON array/object in `content` instead of using API `tool_calls`
 * (e.g. [{ "tool": "punch_list", "action": "add", ... }]). Execute those as real tools.
 */
function tryRecoverJsonToolCallsFromContent(content: string): GroqToolCall[] {
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > 12_000) return [];

  const parsed = tryParseEmbeddedJsonPayload(trimmed);
  if (parsed === null) return [];

  const out: GroqToolCall[] = [];
  const ts = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const pushFromOpenAiShape = (o: Record<string, unknown>) => {
    const fn = o.function;
    if (!isPlainObject(fn)) return;
    const n = fn.name;
    const args = fn.arguments;
    if (typeof n !== "string") return;
    const name = normalizeToolNameForRegistry(n);
    if (!TOOL_REGISTRY[name]) return;
    const argStr =
      typeof args === "string" ? args : JSON.stringify(args ?? {});
    out.push({
      id: `recovered-json-${ts()}`,
      type: "function",
      function: { name, arguments: argStr },
    });
  };

  const pushFromLooseObject = (item: Record<string, unknown>, idx: number) => {
    if (Array.isArray(item.tool_calls)) {
      for (const tc of item.tool_calls) {
        if (isPlainObject(tc)) pushFromOpenAiShape(tc);
      }
      return;
    }

    const nestedFn = item.function;
    if (isPlainObject(nestedFn) && typeof nestedFn.name === "string") {
      pushFromOpenAiShape({ function: nestedFn });
      return;
    }

    const rawName =
      (typeof item.tool === "string" && item.tool) ||
      (typeof item.name === "string" && item.name);
    if (!rawName) return;
    const name = normalizeToolNameForRegistry(rawName);
    if (!TOOL_REGISTRY[name]) return;

    let argStr: string;
    if (isPlainObject(item.arguments)) {
      argStr = JSON.stringify(item.arguments);
    } else if (typeof item.arguments === "string") {
      argStr = item.arguments;
    } else {
      const { tool, name: _n, function: _f, arguments: _a, ...rest } = item;
      argStr = JSON.stringify(rest);
    }

    out.push({
      id: `recovered-json-${ts()}-${idx}`,
      type: "function",
      function: { name, arguments: argStr },
    });
  };

  if (Array.isArray(parsed)) {
    parsed.forEach((item, i) => {
      if (isPlainObject(item)) pushFromLooseObject(item, i);
    });
    return out;
  }

  if (isPlainObject(parsed)) {
    if (Array.isArray(parsed.tool_calls)) {
      for (const tc of parsed.tool_calls) {
        if (isPlainObject(tc)) pushFromOpenAiShape(tc);
      }
      return out;
    }
    pushFromLooseObject(parsed, 0);
  }

  return out;
}

function mergeRecoveredToolCalls(
  content: string,
  tool_calls?: GroqToolCall[]
): { content: string; tool_calls?: GroqToolCall[] } {
  if (tool_calls && tool_calls.length > 0) {
    return { content, tool_calls };
  }
  const fromTag = tryRecoverToolCallsFromTextContent(content);
  if (fromTag.length > 0) {
    console.log("[groq] Recovered tool call(s) from assistant text (malformed <function=...>)");
    return { content: "", tool_calls: fromTag };
  }
  const fromJson = tryRecoverJsonToolCallsFromContent(content);
  if (fromJson.length > 0) {
    console.log(
      `[groq] Recovered ${fromJson.length} tool call(s) from assistant text (JSON payload — model skipped API tool_calls)`
    );
    return { content: "", tool_calls: fromJson };
  }
  return { content, tool_calls: undefined };
}

// ── Helpers ──

/**
 * Llama often emits `workflow_items.update-workflow-artifact` as the function name; Groq only accepts
 * tools that appear in `request.tools`. We register dotted aliases alongside `workflow_items` and map
 * them back before executeTool.
 */
const WORKFLOW_ITEMS_GROQ_QUALIFIED_ALIASES = [
  "add-person-to-workflow",
  "add-content-to-workflow",
  "list-items",
  "move-item",
  "get-workflow-artifact",
  "update-workflow-artifact",
] as const;

function normalizeWorkflowItemsQualifiedToolCall(
  toolName: string,
  args: Record<string, string>
): { toolName: string; args: Record<string, string> } {
  if (!toolName.startsWith("workflow_items.")) {
    return { toolName, args };
  }
  const sub = toolName.slice("workflow_items.".length).trim();
  if (!sub) return { toolName, args };
  const next = { ...args };
  if (!next.command?.trim()) {
    next.command = sub;
  }
  return { toolName: "workflow_items", args: next };
}

function buildGroqTools(allowedTools: string[]): GroqTool[] {
  const filtered = toolDeclarations.filter((t) =>
    allowedTools.includes(t.name)
  );
  const out: GroqTool[] = [];
  for (const t of filtered) {
    const base: GroqTool = {
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object" as const,
          properties: t.parameters.properties,
          required: t.parameters.required,
        },
      },
    };
    out.push(base);

    if (t.name === "workflow_items") {
      for (const sub of WORKFLOW_ITEMS_GROQ_QUALIFIED_ALIASES) {
        out.push({
          type: "function" as const,
          function: {
            name: `workflow_items.${sub}`,
            description: `Same as tool workflow_items with "command":"${sub}" (omit command in arguments).`,
            parameters: {
              type: "object" as const,
              properties: t.parameters.properties,
              required: [],
            },
          },
        });
      }
    }
  }
  return out;
}

/**
 * Strip "[Tools executed]\n  ...\n\n" prefixes from historic messages.
 * These summaries were saved by the Gemini provider and confuse Llama
 * into generating text-format tool calls instead of using the API.
 */
function stripToolSummary(text: string): string {
  return text.replace(/^\[Tools executed\]\n[\s\S]*?\n\n/, "");
}

function buildMessages(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
  hasTools?: boolean
): GroqMessage[] {
  // Reinforce structured tool-calling when tools are present
  const sysContent = hasTools
    ? systemPrompt +
      "\n\nIMPORTANT: Use the provided tool-calling API to invoke tools. " +
      "NEVER write tool calls as XML/text like <function=name{...}> or <function=tool.subcommand({...})>. " +
      "NEVER reply with only a JSON array/object as plain text — that does not execute tools; the API must emit real tool_calls. " +
      "Tool names must match the API list exactly: use `workflow_items` with a `command` field, or a listed alias like `workflow_items.update-workflow-artifact` with arg1–arg3 only. " +
      "Always use the structured tool_calls API. " +
      "After tools run, your reply must match the tool results exactly (same item #s and actions)—do not invent a different outcome."
    : systemPrompt;

  const messages: GroqMessage[] = [
    { role: "system", content: sysContent },
  ];

  for (const msg of history) {
    if (!msg.text) continue;
    const content = msg.role === "model" ? stripToolSummary(msg.text) : msg.text;
    if (!content.trim()) continue;
    messages.push({
      role: msg.role === "model" ? "assistant" : "user",
      content,
    });
  }

  messages.push({ role: "user", content: userMessage });
  return messages;
}

async function groqChat(
  model: string,
  messages: GroqMessage[],
  tools?: GroqTool[],
  temperature?: number,
  debug?: GroqDebugContext
): Promise<{ content: string; tool_calls?: GroqToolCall[]; usage?: GroqUsage }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: 4096,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  if (debug) {
    logGroqChatOutbound(
      { agentId: debug.agentId, iteration: debug.iteration, model },
      messages,
      tools?.map((t) => t.function.name)
    );
  }

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    if (debug) {
      logGroqChatHttpError(
        { agentId: debug.agentId, iteration: debug.iteration, model },
        res.status,
        errText
      );
    }

    // Recover malformed tool calls (Llama generates <function=...> text)
    if (res.status === 400 && errText.includes("tool_use_failed")) {
      try {
        const errJson = JSON.parse(errText);
        const failedGen: string = errJson?.error?.failed_generation || "";
        const fromFailed = tryRecoverToolCallsFromTextContent(failedGen);
        if (fromFailed.length > 0) {
          console.log("[groq] Recovered malformed tool call from failed_generation");
          return { content: "", tool_calls: fromFailed };
        }
        const match = failedGen.match(/<function=(\w+)(\{[\s\S]*?\})>/);
        if (match) {
          const [, name, argsStr] = match;
          JSON.parse(argsStr);
          console.log(`[groq] Recovered malformed tool call: ${name}`);
          return {
            content: "",
            tool_calls: [
              {
                id: `recovered-${Date.now()}`,
                type: "function" as const,
                function: { name, arguments: argsStr },
              },
            ],
          };
        }
      } catch (parseErr) {
        console.error("[groq] Failed to recover malformed tool call:", parseErr);
      }

      // If recovery failed, retry without tools (assistant may hallucinate actions — logged for ops)
      console.warn(
        "[groq] Retrying without tools after tool_use_failed — user may see a non-tool reply; check failed_generation in logs"
      );
      const retryBody = { ...body };
      delete retryBody.tools;
      delete retryBody.tool_choice;
      const retryRes = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(retryBody),
      });
      if (retryRes.ok) {
        const retryData = (await retryRes.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: GroqUsage;
        };
        const retryChoice = retryData.choices?.[0]?.message;
        return {
          content: retryChoice?.content || "",
          tool_calls: undefined,
          usage: retryData.usage,
        };
      }
    }

    throw new Error(`Groq API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; tool_calls?: GroqToolCall[] } }>;
    usage?: GroqUsage;
  };
  const choice = data.choices?.[0]?.message;
  if (debug) {
    logGroqChatRawChoice(
      { agentId: debug.agentId, iteration: debug.iteration, model },
      choice?.content || "",
      choice?.tool_calls
    );
  }
  const merged = mergeRecoveredToolCalls(choice?.content || "", choice?.tool_calls);
  if (debug) {
    logGroqChatMergedResponse(
      { agentId: debug.agentId, iteration: debug.iteration, model },
      {
        content: merged.content,
        tool_calls: merged.tool_calls,
        usage: data.usage,
      }
    );
  }
  return { ...merged, usage: data.usage };
}

// ── Streaming chat ──

export type GroqStreamOptions = ChatStreamExtraOptions & {
  /** Override session file (e.g. LinkedIn triage JSONL). */
  sessionFile?: string;
  /** Text persisted as the user turn (defaults to userMessage). */
  saveMessage?: string;
};

export async function chatStreamGroq(
  agentId: string,
  userMessage: string,
  onChunk: (chunk: string) => void,
  streamOptions?: GroqStreamOptions
): Promise<ChatStreamResult> {
  const config = getAgentConfig(agentId);
  const sessionFile = streamOptions?.sessionFile ?? config.sessionFile;
  const persistedUserText = streamOptions?.saveMessage ?? userMessage;
  const systemPrompt = appendEphemeralContext(
    await getSystemPrompt(config.systemPromptFile, agentId, userMessage),
    streamOptions?.workQueueContext
  );
  let history = getHistory(sessionFile);
  history = applySessionHistoryLimit(history, streamOptions?.sessionHistoryMaxMessages);
  const tools = buildGroqTools(config.tools);
  const model = config.modelName || DEFAULT_MODEL;
  const delegatedAgents = new Set<string>();

  let messages = buildMessages(systemPrompt, history, userMessage, tools.length > 0);
  let iterations = 0;
  const executedCalls = new Set<string>(); // track tool+args to prevent duplicates

  // Tool call loop (non-streaming for tool iterations)
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await groqChat(model, messages, tools, config.temperature, {
      agentId,
      iteration: iterations,
    });
    logGroqUsage(agentId, model, response.usage);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      const text = response.content;
      if (text) {
        addMessage(sessionFile, {
          role: "user",
          text: persistedUserText,
          timestamp: Date.now(),
        });
        const modelMsg: ChatMessage = {
          role: "model",
          text,
          timestamp: Date.now(),
        };
        if (delegatedAgents.size > 0) {
          modelMsg.delegatedFrom = Array.from(delegatedAgents).join(",");
        }
        addMessage(sessionFile, modelMsg);
        if (!isChatEphemeralAgent(agentId)) {
          consolidateSession(agentId, sessionFile).catch(() => {});
        }

        onChunk(text);
        return {
          text,
          delegatedFrom:
            delegatedAgents.size > 0
              ? Array.from(delegatedAgents).join(",")
              : undefined,
        };
      }
      break;
    }

    // Add assistant response with tool calls
    messages.push({
      role: "assistant",
      content: response.content || "",
      tool_calls: response.tool_calls,
    });

    // Execute tool calls and send results back (with dedup)
    const toolNames: string[] = [];
    const batchToolBodies: string[] = [];
    for (const tc of response.tool_calls) {
      const rawName = tc.function.name;
      const stringArgs = parseGroqToolArgumentsJson(
        rawName,
        tc.function.arguments || "{}"
      );
      const { toolName, args: execArgs } = normalizeWorkflowItemsQualifiedToolCall(
        rawName,
        stringArgs
      );

      if (toolName === "delegate_task" && execArgs.agent) {
        delegatedAgents.add(execArgs.agent);
      }

      // Dedup: skip if same tool+args already executed this turn
      const callKey = `${toolName}:${JSON.stringify(execArgs)}`;
      if (executedCalls.has(callKey)) {
        console.log(`[groq] SKIPPED duplicate tool_call: ${rawName}`);
        messages.push({
          role: "tool",
          content: "Already executed — skipping duplicate call.",
          tool_call_id: tc.id,
        });
        continue;
      }
      executedCalls.add(callKey);

      console.log(
        `[groq] tool_call: ${rawName} → ${toolName}`,
        JSON.stringify(execArgs).slice(0, 200)
      );
      const result = await executeTool(toolName, execArgs, userMessage, agentId);
      logGroqToolExecution({ agentId, iteration: iterations }, toolName, execArgs, result);
      console.log(
        `[groq] tool_result: ${toolName} =>`,
        result.slice(0, 200)
      );
      toolNames.push(toolName);
      batchToolBodies.push(result);

      // Groq requires tool_call_id to match the call
      messages.push({
        role: "tool",
        content: result,
        tool_call_id: tc.id,
      });
    }

    // Notify client which tools were used
    for (const tn of toolNames) {
      onChunk(`\n<!--toolUsed:${tn}-->`);
    }

    // Skip second LLM round for simple punch_list outcomes (faster + shorter voice reply)
    const fastReply =
      toolNames.length === 1 &&
      toolNames[0] === "punch_list" &&
      tryPunchListFastUserReply(batchToolBodies);
    if (fastReply) {
      addMessage(sessionFile, {
        role: "user",
        text: persistedUserText,
        timestamp: Date.now(),
      });
      const modelMsg: ChatMessage = {
        role: "model",
        text: fastReply,
        timestamp: Date.now(),
      };
      if (delegatedAgents.size > 0) {
        modelMsg.delegatedFrom = Array.from(delegatedAgents).join(",");
      }
      addMessage(sessionFile, modelMsg);
      if (!isChatEphemeralAgent(agentId)) {
        consolidateSession(agentId, sessionFile).catch(() => {});
      }
      onChunk(fastReply);
      return {
        text: fastReply,
        delegatedFrom:
          delegatedAgents.size > 0
            ? Array.from(delegatedAgents).join(",")
            : undefined,
      };
    }
  }

  // Fallback: final call without tools
  const finalResponse = await groqChat(model, messages, undefined, config.temperature, {
    agentId,
    iteration: "final_no_tools",
  });
  logGroqUsage(agentId, model, finalResponse.usage);
  const fullText = finalResponse.content;

  if (fullText) {
    addMessage(sessionFile, {
      role: "user",
      text: persistedUserText,
      timestamp: Date.now(),
    });
    const modelMsg: ChatMessage = {
      role: "model",
      text: fullText,
      timestamp: Date.now(),
    };
    if (delegatedAgents.size > 0) {
      modelMsg.delegatedFrom = Array.from(delegatedAgents).join(",");
    }
    addMessage(sessionFile, modelMsg);
    if (!isChatEphemeralAgent(agentId)) {
      consolidateSession(agentId, sessionFile).catch(() => {});
    }

    onChunk(fullText);
  }

  return {
    text: fullText,
    delegatedFrom:
      delegatedAgents.size > 0
        ? Array.from(delegatedAgents).join(",")
        : undefined,
  };
}

/** Non-streaming chat (e.g. LinkedIn triage) — reuses tool loop + session persistence. */
export async function chatGroq(
  agentId: string,
  userMessage: string,
  options?: GroqStreamOptions
): Promise<string> {
  let latest = "";
  const result = await chatStreamGroq(
    agentId,
    userMessage,
    (chunk) => {
      latest = chunk;
    },
    options
  );
  return result.text || latest;
}

// ── Autonomous chat (heartbeat / background tasks) ──

export async function autonomousChatGroq(
  agentId: string,
  triggerPrompt: string,
  options?: { maxHistory?: number; fromAgent?: string; sessionFile?: string }
): Promise<string> {
  const config = getAgentConfig(agentId);
  const sessionFile = options?.sessionFile ?? config.sessionFile;
  const systemPrompt = await getSystemPrompt(
    config.systemPromptFile,
    agentId,
    triggerPrompt
  );
  const history = getHistory(sessionFile);
  const tools = buildGroqTools(config.tools);
  const model = config.modelName || DEFAULT_MODEL;

  const maxHistory = options?.maxHistory ?? 20;
  const recentHistory = history.slice(-maxHistory);

  if (options?.fromAgent) {
    addMessage(sessionFile, {
      role: "user",
      text: triggerPrompt,
      timestamp: Date.now(),
      fromAgent: options.fromAgent,
    });
  }

  let messages = buildMessages(systemPrompt, recentHistory, triggerPrompt, tools.length > 0);
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await groqChat(model, messages, tools, config.temperature, {
      agentId,
      iteration: iterations,
    });
    logGroqUsage(agentId, model, response.usage);

    if (response.tool_calls && response.tool_calls.length > 0) {
      messages.push({
        role: "assistant",
        content: response.content || "",
        tool_calls: response.tool_calls,
      });

      for (const tc of response.tool_calls) {
        const stringArgs = parseGroqToolArgumentsJson(
          tc.function.name,
          tc.function.arguments || "{}"
        );
        const { toolName, args } = normalizeWorkflowItemsQualifiedToolCall(
          tc.function.name,
          stringArgs
        );
        const result = await executeTool(
          toolName,
          args,
          "[autonomous-heartbeat]",
          agentId
        );
        logGroqToolExecution({ agentId, iteration: iterations }, toolName, args, result);
        messages.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id,
        });
      }
      continue;
    }

    const replyText = response.content;
    if (replyText) {
      addMessage(sessionFile, {
        role: "model",
        text: replyText,
        timestamp: Date.now(),
        ambient: true,
      });
      return replyText;
    }

    break;
  }

  if (options?.fromAgent && iterations > 0) {
    const fallbackMsg = "(Task was processed but no summary was generated)";
    addMessage(sessionFile, {
      role: "model",
      text: fallbackMsg,
      timestamp: Date.now(),
      ambient: true,
    });
    return fallbackMsg;
  }

  return "";
}
