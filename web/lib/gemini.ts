import { GoogleGenAI, Type } from "@google/genai";
import { getSystemPrompt } from "./system-prompt";
import { toolDeclarations, executeTool, TOOL_REGISTRY } from "./tools";
import { toolArgumentsToStringRecord } from "./tool-args-normalize";
import { getHistory, addMessage, type ChatMessage } from "./session-store";
import { getAgentConfig } from "./agent-config";
import { consolidateSession } from "./memory";
import {
  appendEphemeralContext,
  applySessionHistoryLimit,
  type ChatStreamExtraOptions,
} from "./chat-stream-options";
import { getGeminiApiKey } from "./gemini-api-key";
import {
  logGeminiUsageFromResponse,
  logGeminiUsageFromStreamChunk,
} from "./llm-usage-log";

const MAX_TOOL_ITERATIONS = 20;

/**
 * Build a summary string of tool calls executed during a conversation turn.
 * This gets prepended to the saved model message so session history shows
 * evidence of tool usage, preventing the model from learning that text-only
 * "I did it!" responses are acceptable.
 */
function buildToolSummary(calls: Array<{ name: string; args: Record<string, string>; result: string }>): string {
  if (calls.length === 0) return "";
  const lines = calls.map((c) => {
    const argStr = Object.entries(c.args)
      .filter(([k]) => k !== "command")
      .map(([k, v]) => `${k}=${String(v).slice(0, 50)}`)
      .join(", ");
    const cmd = c.args.command ? `(${c.args.command})` : "";
    const shortResult = c.result.slice(0, 100);
    return `  ${c.name}${cmd}${argStr ? ` [${argStr}]` : ""} → ${shortResult}`;
  });
  return `[Tools executed]\n${lines.join("\n")}\n\n`;
}

function getClient(): GoogleGenAI {
  const key = getGeminiApiKey();
  if (!key) {
    throw new Error("GEMINI_API_KEY (or GOOGLE_API_KEY) is not set for Gemini chat.");
  }
  return new GoogleGenAI({ apiKey: key });
}

function buildGeminiTools(allowedTools: string[]) {
  const filtered = toolDeclarations.filter((t) =>
    allowedTools.includes(t.name)
  );
  if (filtered.length === 0) return undefined;
  return [
    {
      functionDeclarations: filtered.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: Type.OBJECT,
          properties: Object.fromEntries(
            Object.entries(t.parameters.properties).map(([k, v]) => [
              k,
              { type: Type.STRING, description: v.description },
            ])
          ),
          required: t.parameters.required,
        },
      })),
    },
  ];
}

export async function chat(
  agentId: string,
  userMessage: string,
  options?: { sessionFile?: string; saveMessage?: string }
): Promise<string> {
  const ai = getClient();
  const config = getAgentConfig(agentId);
  const systemPrompt = await getSystemPrompt(config.systemPromptFile, agentId, userMessage);
  const sessionFile = options?.sessionFile || config.sessionFile;
  const history = getHistory(sessionFile);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents: any[] = history.map((msg: ChatMessage) => ({
    role: msg.role,
    parts: [{ text: msg.text }],
  }));
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  // saveMessage: what gets persisted to session (defaults to userMessage).
  // Useful when userMessage has ephemeral context (e.g., thread preamble)
  // that shouldn't be saved since it's re-fetched each time.
  const messageToSave = options?.saveMessage ?? userMessage;

  const tools = buildGeminiTools(config.tools);
  const delegatedAgents = new Set<string>();
  const executedTools: Array<{ name: string; args: Record<string, string>; result: string }> = [];
  const geminiModel = config.modelName || "gemini-2.5-flash";

  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await ai.models.generateContent({
      model: geminiModel,
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: config.temperature ?? 0.7,
        maxOutputTokens: 4096,
        tools,
      },
    });

    logGeminiUsageFromResponse(agentId, geminiModel, response);

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      break;
    }

    const parts = candidate.content.parts;
    const functionCalls = parts.filter((p) => p.functionCall);

    if (functionCalls.length > 0) {
      // Hallucination guard: validate tool names before executing
      const validCalls = [];
      const invalidCalls = [];
      for (const fc of functionCalls) {
        const toolName = fc.functionCall?.name;
        if (toolName && TOOL_REGISTRY[toolName]) {
          validCalls.push(fc);
        } else {
          invalidCalls.push(fc);
        }
      }

      contents.push({ role: "model", parts });

      // If ALL calls are hallucinated, feed back error and let model retry
      if (validCalls.length === 0 && invalidCalls.length > 0) {
        const badNames = invalidCalls.map((fc) => fc.functionCall?.name).join(", ");
        contents.push({
          role: "user",
          parts: invalidCalls.map((fc) => ({
            functionResponse: {
              name: fc.functionCall!.name!,
              response: {
                result: `ERROR: Tool "${fc.functionCall!.name}" does not exist. Available tools: ${config.tools.join(", ")}. Use ONLY these tools. Do NOT invent tool names.`,
              },
            },
          })),
        });
        console.warn(`[${agentId}] Hallucination guard: rejected tools [${badNames}]`);
        continue;
      }

      // Track delegate_task calls for attribution
      for (const fc of validCalls) {
        if (fc.functionCall?.name === "delegate_task") {
          const args = toolArgumentsToStringRecord(
            "delegate_task",
            fc.functionCall.args
          );
          if (args.agent) delegatedAgents.add(args.agent);
        }
      }

      // Execute valid calls; return errors for invalid ones
      const allResponses = [];
      for (const fc of validCalls) {
        const name = fc.functionCall!.name!;
        const args = toolArgumentsToStringRecord(name, fc.functionCall!.args);
        const result = await executeTool(
          name,
          args,
          userMessage,
          agentId
        );
        executedTools.push({ name, args, result });
        allResponses.push({
          functionResponse: {
            name: fc.functionCall!.name!,
            response: { result },
          },
        });
      }
      for (const fc of invalidCalls) {
        allResponses.push({
          functionResponse: {
            name: fc.functionCall!.name!,
            response: {
              result: `ERROR: Tool "${fc.functionCall!.name}" does not exist. Use ONLY these tools: ${config.tools.join(", ")}`,
            },
          },
        });
      }

      contents.push({
        role: "user",
        parts: allResponses,
      });

      continue;
    }

    const textParts = parts.filter((p) => p.text);
    const replyText = textParts.map((p) => p.text).join("");

    if (replyText) {
      addMessage(sessionFile, {
        role: "user",
        text: messageToSave,
        timestamp: Date.now(),
      });

      // Prepend tool summary so session history shows evidence of tool usage
      const toolSummary = buildToolSummary(executedTools);
      const modelMsg: ChatMessage = {
        role: "model",
        text: toolSummary + replyText,
        timestamp: Date.now(),
      };
      if (delegatedAgents.size > 0) {
        modelMsg.delegatedFrom = Array.from(delegatedAgents).join(",");
      }
      addMessage(sessionFile, modelMsg);

      // Fire-and-forget: consolidate if session is long
      consolidateSession(agentId, sessionFile).catch(() => {});

      return replyText;
    }

    break;
  }

  return "I couldn't generate a response. Please try again.";
}

/**
 * Autonomous chat: lightweight variant for background tasks (heartbeat, scheduled checks).
 * - Loads only recent history (default 20 messages) instead of full session
 * - Does NOT save the trigger prompt as a user message — only saves model response
 * - Tool safety preserved: passes "[autonomous-heartbeat]" as lastUserMessage
 *   so send/schedule approval barriers remain active
 */
export async function autonomousChat(
  agentId: string,
  triggerPrompt: string,
  options?: { maxHistory?: number; fromAgent?: string }
): Promise<string> {
  const ai = getClient();
  const config = getAgentConfig(agentId);
  const systemPrompt = await getSystemPrompt(config.systemPromptFile, agentId, triggerPrompt);
  const history = getHistory(config.sessionFile);

  const maxHistory = options?.maxHistory ?? 20;
  const recentHistory = history.slice(-maxHistory);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents: any[] = recentHistory.map((msg: ChatMessage) => ({
    role: msg.role,
    parts: [{ text: msg.text }],
  }));
  contents.push({ role: "user", parts: [{ text: triggerPrompt }] });

  const tools = buildGeminiTools(config.tools);
  const geminiModelAuto = config.modelName || "gemini-2.5-flash";

  // Save the trigger prompt immediately if it came from another agent,
  // so it appears in the target agent's chat history even if execution fails
  if (options?.fromAgent) {
    addMessage(config.sessionFile, {
      role: "user",
      text: triggerPrompt,
      timestamp: Date.now(),
      fromAgent: options.fromAgent,
    });
  }

  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await ai.models.generateContent({
      model: geminiModelAuto,
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: config.temperature ?? 0.7,
        maxOutputTokens: 4096,
        tools,
      },
    });

    logGeminiUsageFromResponse(agentId, geminiModelAuto, response);

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) break;

    const parts = candidate.content.parts;
    const functionCalls = parts.filter((p) => p.functionCall);

    if (functionCalls.length > 0) {
      // Hallucination guard: validate tool names
      const validCalls = [];
      const invalidCalls = [];
      for (const fc of functionCalls) {
        const toolName = fc.functionCall?.name;
        if (toolName && TOOL_REGISTRY[toolName]) {
          validCalls.push(fc);
        } else {
          invalidCalls.push(fc);
        }
      }

      contents.push({ role: "model", parts });

      if (validCalls.length === 0 && invalidCalls.length > 0) {
        const badNames = invalidCalls.map((fc) => fc.functionCall?.name).join(", ");
        contents.push({
          role: "user",
          parts: invalidCalls.map((fc) => ({
            functionResponse: {
              name: fc.functionCall!.name!,
              response: {
                result: `ERROR: Tool "${fc.functionCall!.name}" does not exist. Available tools: ${config.tools.join(", ")}. Use ONLY these tools.`,
              },
            },
          })),
        });
        console.warn(`[${agentId}] Hallucination guard (autonomous): rejected [${badNames}]`);
        continue;
      }

      const allResponses = [];
      for (const fc of validCalls) {
        const name = fc.functionCall!.name!;
        const args = toolArgumentsToStringRecord(name, fc.functionCall!.args);
        const result = await executeTool(
          name,
          args,
          "[autonomous-heartbeat]",
          agentId
        );
        allResponses.push({
          functionResponse: {
            name: fc.functionCall!.name!,
            response: { result },
          },
        });
      }
      for (const fc of invalidCalls) {
        allResponses.push({
          functionResponse: {
            name: fc.functionCall!.name!,
            response: {
              result: `ERROR: Tool "${fc.functionCall!.name}" does not exist. Use ONLY: ${config.tools.join(", ")}`,
            },
          },
        });
      }

      contents.push({ role: "user", parts: allResponses });
      continue;
    }

    const textParts = parts.filter((p) => p.text);
    const replyText = textParts.map((p) => p.text).join("");

    if (replyText) {
      addMessage(config.sessionFile, {
        role: "model",
        text: replyText,
        timestamp: Date.now(),
        ambient: true,
      });

      return replyText;
    }

    break;
  }

  // If we got here with no text response but this was a delegated task,
  // save a note so the agent's session reflects the attempt
  if (options?.fromAgent && iterations > 0) {
    const fallbackMsg = "(Task was processed but no summary was generated)";
    addMessage(config.sessionFile, {
      role: "model",
      text: fallbackMsg,
      timestamp: Date.now(),
      ambient: true,
    });
    return fallbackMsg;
  }

  return "";
}

/**
 * Streaming chat: handles tool calls non-streaming, then streams the final text response.
 * Yields text chunks via the onChunk callback.
 */
export interface ChatStreamResult {
  text: string;
  delegatedFrom?: string; // comma-separated agent IDs
}

export async function chatStream(
  agentId: string,
  userMessage: string,
  onChunk: (chunk: string) => void,
  extra?: ChatStreamExtraOptions
): Promise<ChatStreamResult> {
  const ai = getClient();
  const config = getAgentConfig(agentId);
  const systemPrompt = appendEphemeralContext(
    await getSystemPrompt(config.systemPromptFile, agentId, userMessage),
    extra?.workQueueContext
  );
  let history = getHistory(config.sessionFile);
  history = applySessionHistoryLimit(history, extra?.sessionHistoryMaxMessages);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents: any[] = history.map((msg: ChatMessage) => ({
    role: msg.role,
    parts: [{ text: msg.text }],
  }));
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  const tools = buildGeminiTools(config.tools);
  const geminiModelStream = config.modelName || "gemini-2.5-flash";
  const geminiConfig = {
    systemInstruction: systemPrompt,
    temperature: config.temperature ?? 0.7,
    maxOutputTokens: 4096,
    tools,
  };
  const delegatedAgents = new Set<string>();
  const executedTools: Array<{ name: string; args: Record<string, string>; result: string }> = [];

  let iterations = 0;

  // Handle tool call loop (non-streaming — need full response to execute tools)
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await ai.models.generateContent({
      model: geminiModelStream,
      contents,
      config: geminiConfig,
    });

    logGeminiUsageFromResponse(agentId, geminiModelStream, response);

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) break;

    const parts = candidate.content.parts;
    const functionCalls = parts.filter((p) => p.functionCall);

    if (functionCalls.length === 0) {
      // Check if this response already contains text (common after tool results)
      const inlineText = parts.filter((p) => p.text).map((p) => p.text).join("");
      if (inlineText) {
        // Model already produced a text response — use it directly instead of re-calling
        addMessage(config.sessionFile, {
          role: "user",
          text: userMessage,
          timestamp: Date.now(),
        });
        const toolSummary = buildToolSummary(executedTools);
        const modelMsg: ChatMessage = {
          role: "model",
          text: toolSummary + inlineText,
          timestamp: Date.now(),
        };
        if (delegatedAgents.size > 0) {
          modelMsg.delegatedFrom = Array.from(delegatedAgents).join(",");
        }
        addMessage(config.sessionFile, modelMsg);
        consolidateSession(agentId, config.sessionFile).catch(() => {});

        // Send the text as a single chunk
        onChunk(inlineText);
        return {
          text: inlineText,
          delegatedFrom: delegatedAgents.size > 0
            ? Array.from(delegatedAgents).join(",")
            : undefined,
        };
      }
      break; // No text — fall through to streaming call
    }

    // Hallucination guard: validate tool names
    const validCalls = [];
    const invalidCalls = [];
    for (const fc of functionCalls) {
      const toolName = fc.functionCall?.name;
      if (toolName && TOOL_REGISTRY[toolName]) {
        validCalls.push(fc);
      } else {
        invalidCalls.push(fc);
      }
    }

    contents.push({ role: "model", parts });

    if (validCalls.length === 0 && invalidCalls.length > 0) {
      const badNames = invalidCalls.map((fc) => fc.functionCall?.name).join(", ");
      contents.push({
        role: "user",
        parts: invalidCalls.map((fc) => ({
          functionResponse: {
            name: fc.functionCall!.name!,
            response: {
              result: `ERROR: Tool "${fc.functionCall!.name}" does not exist. Available tools: ${config.tools.join(", ")}. Use ONLY these tools. Do NOT invent tool names.`,
            },
          },
        })),
      });
      console.warn(`[${agentId}] Hallucination guard (stream): rejected [${badNames}]`);
      continue;
    }

    // Track delegate_task calls for attribution
    for (const fc of validCalls) {
      if (fc.functionCall?.name === "delegate_task") {
        const args = toolArgumentsToStringRecord(
          "delegate_task",
          fc.functionCall.args
        );
        if (args.agent) delegatedAgents.add(args.agent);
      }
    }

    const toolNames: string[] = [];
    const allResponses = [];
    for (const fc of validCalls) {
      const toolName = fc.functionCall!.name!;
      const args = toolArgumentsToStringRecord(toolName, fc.functionCall!.args);
      const result = await executeTool(
        toolName,
        args,
        userMessage,
        agentId
      );
      toolNames.push(toolName);
      executedTools.push({ name: toolName, args, result });
      allResponses.push({
        functionResponse: {
          name: toolName,
          response: { result },
        },
      });
    }
    for (const fc of invalidCalls) {
      allResponses.push({
        functionResponse: {
          name: fc.functionCall!.name!,
          response: {
            result: `ERROR: Tool "${fc.functionCall!.name}" does not exist. Use ONLY: ${config.tools.join(", ")}`,
          },
        },
      });
    }

    // Notify the client which tools were used (for panel refresh)
    for (const tn of toolNames) {
      onChunk(`\n<!--toolUsed:${tn}-->`);
    }

    contents.push({ role: "user", parts: allResponses });
  }

  // Stream the final text response
  let fullText = "";
  let lastStreamChunk: unknown;

  const stream = await ai.models.generateContentStream({
    model: geminiModelStream,
    contents,
    config: geminiConfig,
  });

  for await (const chunk of stream) {
    lastStreamChunk = chunk;
    const text = chunk.text;
    if (text) {
      fullText += text;
      onChunk(text);
    }
  }

  logGeminiUsageFromStreamChunk(agentId, geminiModelStream, lastStreamChunk);

  if (fullText) {
    addMessage(config.sessionFile, {
      role: "user",
      text: userMessage,
      timestamp: Date.now(),
    });

    const toolSummary = buildToolSummary(executedTools);
    const modelMsg: ChatMessage = {
      role: "model",
      text: toolSummary + fullText,
      timestamp: Date.now(),
    };
    if (delegatedAgents.size > 0) {
      modelMsg.delegatedFrom = Array.from(delegatedAgents).join(",");
    }
    addMessage(config.sessionFile, modelMsg);

    // Fire-and-forget: consolidate if session is long
    consolidateSession(agentId, config.sessionFile).catch(() => {});
  }

  const delegatedFrom = delegatedAgents.size > 0
    ? Array.from(delegatedAgents).join(",")
    : undefined;

  return {
    text: fullText || "I couldn't generate a response. Please try again.",
    delegatedFrom,
  };
}
