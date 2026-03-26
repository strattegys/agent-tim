/**
 * Ollama chat provider — uses the native Ollama API for local LLM inference.
 * Supports tool calling (Qwen 2.5 has excellent tool use).
 */

import { getSystemPrompt } from "./system-prompt";
import { toolDeclarations, executeTool } from "./tools";
import { getHistory, addMessage, type ChatMessage } from "./session-store";
import { getAgentConfig } from "./agent-config";
import { consolidateSession } from "./memory";
import type { ChatStreamResult } from "./gemini";
import { appendEphemeralContext, type ChatStreamExtraOptions } from "./chat-stream-options";

const MAX_TOOL_ITERATIONS = 20;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaTool {
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

function buildOllamaTools(allowedTools: string[]): OllamaTool[] {
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

function buildMessages(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string
): OllamaMessage[] {
  const messages: OllamaMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of history) {
    if (!msg.text) continue;
    messages.push({
      role: msg.role === "model" ? "assistant" : "user",
      content: msg.text,
    });
  }

  messages.push({ role: "user", content: userMessage });
  return messages;
}

async function ollamaChat(
  model: string,
  messages: OllamaMessage[],
  tools?: OllamaTool[]
): Promise<{ content: string; tool_calls?: OllamaToolCall[] }> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown error");
    throw new Error(`Ollama API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    content: data.message?.content || "",
    tool_calls: data.message?.tool_calls,
  };
}

/**
 * Streaming chat with Ollama — handles tool calls non-streaming,
 * then streams the final text response.
 */
export async function chatStreamOllama(
  agentId: string,
  userMessage: string,
  onChunk: (chunk: string) => void,
  extra?: ChatStreamExtraOptions
): Promise<ChatStreamResult> {
  const config = getAgentConfig(agentId);
  const systemPrompt = appendEphemeralContext(
    await getSystemPrompt(config.systemPromptFile, agentId, userMessage),
    extra?.workQueueContext
  );
  const history = getHistory(config.sessionFile);
  const tools = buildOllamaTools(config.tools);
  const model = config.modelName || "qwen2.5:7b";
  const delegatedAgents = new Set<string>();

  let messages = buildMessages(systemPrompt, history, userMessage);
  let iterations = 0;

  // Tool call loop (non-streaming)
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await ollamaChat(model, messages, tools);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      // No tool calls — we have the final text
      const text = response.content;
      if (text) {
        addMessage(config.sessionFile, {
          role: "user",
          text: userMessage,
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
        addMessage(config.sessionFile, modelMsg);
        consolidateSession(agentId, config.sessionFile).catch(() => {});

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
      if (tc.function.name === "delegate_task") {
        const args = tc.function.arguments as Record<string, string>;
        if (args?.agent) delegatedAgents.add(args.agent);
      }
    }

    // Execute tool calls
    const toolNames: string[] = [];
    for (const tc of response.tool_calls) {
      const toolName = tc.function.name;
      const stringArgs: Record<string, string> = {};
      for (const [k, v] of Object.entries(tc.function.arguments || {})) {
        stringArgs[k] = typeof v === "string" ? v : JSON.stringify(v);
      }

      console.log(
        `[ollama] tool_call: ${toolName}`,
        JSON.stringify(stringArgs).slice(0, 200)
      );
      const result = await executeTool(toolName, stringArgs, userMessage, agentId);
      console.log(
        `[ollama] tool_result: ${toolName} =>`,
        result.slice(0, 200)
      );
      toolNames.push(toolName);

      messages.push({
        role: "tool",
        content: result,
      });
    }

    // Notify client which tools were used
    for (const tn of toolNames) {
      onChunk(`\n<!--toolUsed:${tn}-->`);
    }
  }

  // If we got here without returning, do a final call without tools
  const finalResponse = await ollamaChat(model, messages);
  const fullText = finalResponse.content;

  if (fullText) {
    addMessage(config.sessionFile, {
      role: "user",
      text: userMessage,
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
    addMessage(config.sessionFile, modelMsg);
    consolidateSession(agentId, config.sessionFile).catch(() => {});

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

/**
 * Autonomous (non-streaming) chat with Ollama — used by heartbeat.
 */
export async function autonomousChatOllama(
  agentId: string,
  triggerPrompt: string,
  options?: { maxHistory?: number; fromAgent?: string }
): Promise<string> {
  const config = getAgentConfig(agentId);
  const systemPrompt = await getSystemPrompt(
    config.systemPromptFile,
    agentId,
    triggerPrompt
  );
  const history = getHistory(config.sessionFile);
  const tools = buildOllamaTools(config.tools);
  const model = config.modelName || "qwen2.5:7b";

  const maxHistory = options?.maxHistory ?? 20;
  const recentHistory = history.slice(-maxHistory);

  if (options?.fromAgent) {
    addMessage(config.sessionFile, {
      role: "user",
      text: triggerPrompt,
      timestamp: Date.now(),
      fromAgent: options.fromAgent,
    });
  }

  let messages = buildMessages(systemPrompt, recentHistory, triggerPrompt);
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await ollamaChat(model, messages, tools);

    if (response.tool_calls && response.tool_calls.length > 0) {
      messages.push({
        role: "assistant",
        content: response.content || "",
        tool_calls: response.tool_calls,
      });

      for (const tc of response.tool_calls) {
        const stringArgs: Record<string, string> = {};
        for (const [k, v] of Object.entries(tc.function.arguments || {})) {
          stringArgs[k] = typeof v === "string" ? v : JSON.stringify(v);
        }
        const result = await executeTool(
          tc.function.name,
          stringArgs,
          "[autonomous-heartbeat]",
          agentId
        );
        messages.push({ role: "tool", content: result });
      }
      continue;
    }

    const replyText = response.content;
    if (replyText) {
      addMessage(config.sessionFile, {
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
    addMessage(config.sessionFile, {
      role: "model",
      text: fallbackMsg,
      timestamp: Date.now(),
    });
    return fallbackMsg;
  }

  return "";
}
