/**
 * Groq chat provider — OpenAI-compatible API with fast inference.
 * Supports tool calling via local tool calling pattern.
 */

import { getSystemPrompt } from "./system-prompt";
import { toolDeclarations, executeTool } from "./tools";
import { getHistory, addMessage, type ChatMessage } from "./session-store";
import { getAgentConfig, isChatEphemeralAgent } from "./agent-config";
import { consolidateSession } from "./memory";
import type { ChatStreamResult } from "./gemini";
import { appendEphemeralContext, type ChatStreamExtraOptions } from "./chat-stream-options";

const MAX_TOOL_ITERATIONS = 20;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

// ── Types (OpenAI-compatible) ──

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

// ── Helpers ──

function buildGroqTools(allowedTools: string[]): GroqTool[] {
  const filtered = toolDeclarations.filter((t) =>
    allowedTools.includes(t.name)
  );
  return filtered.map((t) => ({
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
  }));
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
      "NEVER write tool calls as XML/text like <function=name{...}>. " +
      "Always use the structured tool_calls API."
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
  temperature?: number
): Promise<{ content: string; tool_calls?: GroqToolCall[] }> {
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

    // Recover malformed tool calls (Llama generates <function=name{args}> text)
    if (res.status === 400 && errText.includes("tool_use_failed")) {
      try {
        const errJson = JSON.parse(errText);
        const failedGen: string = errJson?.error?.failed_generation || "";
        const match = failedGen.match(/<function=(\w+)(\{[\s\S]*?\})>/);
        if (match) {
          const [, name, argsStr] = match;
          // Validate the args are parseable JSON
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

      // If recovery failed, retry without tools
      console.log("[groq] Retrying without tools after tool_use_failed");
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
        const retryData = await retryRes.json();
        const retryChoice = retryData.choices?.[0]?.message;
        return { content: retryChoice?.content || "", tool_calls: undefined };
      }
    }

    throw new Error(`Groq API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0]?.message;
  return {
    content: choice?.content || "",
    tool_calls: choice?.tool_calls,
  };
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
  const history = getHistory(sessionFile);
  const tools = buildGroqTools(config.tools);
  const model = config.modelName || DEFAULT_MODEL;
  const delegatedAgents = new Set<string>();

  let messages = buildMessages(systemPrompt, history, userMessage, tools.length > 0);
  let iterations = 0;
  const executedCalls = new Set<string>(); // track tool+args to prevent duplicates

  // Tool call loop (non-streaming for tool iterations)
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await groqChat(model, messages, tools, config.temperature);

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

    // Track delegate_task calls
    for (const tc of response.tool_calls) {
      const parsed = JSON.parse(tc.function.arguments || "{}");
      if (tc.function.name === "delegate_task" && parsed?.agent) {
        delegatedAgents.add(parsed.agent);
      }
    }

    // Execute tool calls and send results back (with dedup)
    const toolNames: string[] = [];
    for (const tc of response.tool_calls) {
      const toolName = tc.function.name;
      const parsed = JSON.parse(tc.function.arguments || "{}");
      const stringArgs: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        stringArgs[k] = typeof v === "string" ? v : JSON.stringify(v);
      }

      // Dedup: skip if same tool+args already executed this turn
      const callKey = `${toolName}:${JSON.stringify(stringArgs)}`;
      if (executedCalls.has(callKey)) {
        console.log(`[groq] SKIPPED duplicate tool_call: ${toolName}`);
        messages.push({
          role: "tool",
          content: "Already executed — skipping duplicate call.",
          tool_call_id: tc.id,
        });
        continue;
      }
      executedCalls.add(callKey);

      console.log(
        `[groq] tool_call: ${toolName}`,
        JSON.stringify(stringArgs).slice(0, 200)
      );
      const result = await executeTool(toolName, stringArgs, userMessage, agentId);
      console.log(
        `[groq] tool_result: ${toolName} =>`,
        result.slice(0, 200)
      );
      toolNames.push(toolName);

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
  }

  // Fallback: final call without tools
  const finalResponse = await groqChat(model, messages, undefined, config.temperature);
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

    const response = await groqChat(model, messages, tools, config.temperature);

    if (response.tool_calls && response.tool_calls.length > 0) {
      messages.push({
        role: "assistant",
        content: response.content || "",
        tool_calls: response.tool_calls,
      });

      for (const tc of response.tool_calls) {
        const parsed = JSON.parse(tc.function.arguments || "{}");
        const stringArgs: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          stringArgs[k] = typeof v === "string" ? v : JSON.stringify(v);
        }
        const result = await executeTool(
          tc.function.name,
          stringArgs,
          "[autonomous-heartbeat]",
          agentId
        );
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
    });
    return fallbackMsg;
  }

  return "";
}
