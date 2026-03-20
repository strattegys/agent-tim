import { GoogleGenAI, Type } from "@google/genai";
import { getSystemPrompt } from "./system-prompt";
import { toolDeclarations, executeTool } from "./tools";
import { getHistory, addMessage, type ChatMessage } from "./session-store";
import { getAgentConfig } from "./agent-config";
import { consolidateSession } from "./memory";

const MAX_TOOL_ITERATIONS = 20;

function getClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
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
  const systemPrompt = getSystemPrompt(config.systemPromptFile, agentId);
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

  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await ai.models.generateContent({
      model: config.modelName || "gemini-2.5-flash",
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7,
        maxOutputTokens: 4096,
        tools,
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      break;
    }

    const parts = candidate.content.parts;
    const functionCalls = parts.filter((p) => p.functionCall);

    if (functionCalls.length > 0) {
      contents.push({ role: "model", parts });

      // Track delegate_task calls for attribution
      for (const fc of functionCalls) {
        if (fc.functionCall?.name === "delegate_task") {
          const args = fc.functionCall.args as Record<string, string>;
          if (args?.agent) delegatedAgents.add(args.agent);
        }
      }

      const functionResponses = await Promise.all(
        functionCalls.map(async (fc) => {
          const result = await executeTool(
            fc.functionCall!.name!,
            (fc.functionCall!.args as Record<string, string>) || {},
            userMessage,
            agentId
          );
          return {
            functionResponse: {
              name: fc.functionCall!.name!,
              response: { result },
            },
          };
        })
      );

      contents.push({
        role: "user",
        parts: functionResponses,
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

      const modelMsg: ChatMessage = {
        role: "model",
        text: replyText,
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
  const systemPrompt = getSystemPrompt(config.systemPromptFile, agentId);
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
      model: config.modelName || "gemini-2.5-flash",
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7,
        maxOutputTokens: 4096,
        tools,
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) break;

    const parts = candidate.content.parts;
    const functionCalls = parts.filter((p) => p.functionCall);

    if (functionCalls.length > 0) {
      contents.push({ role: "model", parts });

      const functionResponses = await Promise.all(
        functionCalls.map(async (fc) => {
          const result = await executeTool(
            fc.functionCall!.name!,
            (fc.functionCall!.args as Record<string, string>) || {},
            "[autonomous-heartbeat]", // Won't match approval phrases
            agentId
          );
          return {
            functionResponse: {
              name: fc.functionCall!.name!,
              response: { result },
            },
          };
        })
      );

      contents.push({ role: "user", parts: functionResponses });
      continue;
    }

    const textParts = parts.filter((p) => p.text);
    const replyText = textParts.map((p) => p.text).join("");

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

  // If we got here with no text response but this was a delegated task,
  // save a note so the agent's session reflects the attempt
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
  onChunk: (chunk: string) => void
): Promise<ChatStreamResult> {
  const ai = getClient();
  const config = getAgentConfig(agentId);
  const systemPrompt = getSystemPrompt(config.systemPromptFile, agentId);
  const history = getHistory(config.sessionFile);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents: any[] = history.map((msg: ChatMessage) => ({
    role: msg.role,
    parts: [{ text: msg.text }],
  }));
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  const tools = buildGeminiTools(config.tools);
  const geminiConfig = {
    systemInstruction: systemPrompt,
    temperature: 0.7,
    maxOutputTokens: 4096,
    tools,
  };
  const delegatedAgents = new Set<string>();

  let iterations = 0;

  // Handle tool call loop (non-streaming — need full response to execute tools)
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await ai.models.generateContent({
      model: config.modelName || "gemini-2.5-flash",
      contents,
      config: geminiConfig,
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) break;

    const parts = candidate.content.parts;
    const functionCalls = parts.filter((p) => p.functionCall);

    if (functionCalls.length === 0) break; // No more tool calls — stream the final response

    contents.push({ role: "model", parts });

    // Track delegate_task calls for attribution
    for (const fc of functionCalls) {
      if (fc.functionCall?.name === "delegate_task") {
        const args = fc.functionCall.args as Record<string, string>;
        if (args?.agent) delegatedAgents.add(args.agent);
      }
    }

    const functionResponses = await Promise.all(
      functionCalls.map(async (fc) => {
        const result = await executeTool(
          fc.functionCall!.name!,
          (fc.functionCall!.args as Record<string, string>) || {},
          userMessage,
          agentId
        );
        return {
          functionResponse: {
            name: fc.functionCall!.name!,
            response: { result },
          },
        };
      })
    );

    contents.push({ role: "user", parts: functionResponses });
  }

  // Stream the final text response
  let fullText = "";

  const stream = await ai.models.generateContentStream({
    model: config.modelName || "gemini-2.5-flash",
    contents,
    config: geminiConfig,
  });

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) {
      fullText += text;
      onChunk(text);
    }
  }

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
