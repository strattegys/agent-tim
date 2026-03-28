import Anthropic from "@anthropic-ai/sdk";
import { getSystemPrompt } from "./system-prompt";
import { toolDeclarations, executeTool } from "./tools";
import { toolArgumentsToStringRecord } from "./tool-args-normalize";
import { getHistory, addMessage, type ChatMessage } from "./session-store";
import { getAgentConfig } from "./agent-config";
import { consolidateSession } from "./memory";
import type { ChatStreamResult } from "./gemini";
import { appendEphemeralContext, type ChatStreamExtraOptions } from "./chat-stream-options";
import { logCommandCentralLlmUsage } from "./llm-usage-log";

const MAX_TOOL_ITERATIONS = 20;

function logAnthropicMessageUsage(
  agentId: string,
  model: string,
  response: { usage?: { input_tokens?: number; output_tokens?: number } | null }
): void {
  const u = response.usage;
  if (!u) return;
  logCommandCentralLlmUsage({
    provider: "anthropic",
    model,
    agentId,
    inputTokens: u.input_tokens ?? null,
    outputTokens: u.output_tokens ?? null,
  });
}

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

/** Convert our tool declarations to Anthropic's tool format. */
function buildAnthropicTools(allowedTools: string[]): Anthropic.Tool[] {
  const filtered = toolDeclarations.filter((t) =>
    allowedTools.includes(t.name)
  );
  return filtered.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object" as const,
      properties: Object.fromEntries(
        Object.entries(t.parameters.properties).map(([k, v]) => [
          k,
          { type: "string" as const, description: v.description },
        ])
      ),
      required: t.parameters.required,
    },
  }));
}

/** Convert session history to Anthropic message format. */
function buildMessages(
  history: ChatMessage[],
  userMessage: string
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

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

/**
 * Streaming chat via Anthropic API — handles tool calls, then streams the final text.
 */
export async function chatStreamAnthropic(
  agentId: string,
  userMessage: string,
  onChunk: (chunk: string) => void,
  extra?: ChatStreamExtraOptions
): Promise<ChatStreamResult> {
  const client = getClient();
  const config = getAgentConfig(agentId);
  const systemPrompt = appendEphemeralContext(
    await getSystemPrompt(config.systemPromptFile, agentId, userMessage),
    extra?.workQueueContext
  );
  const history = getHistory(config.sessionFile);
  const tools = buildAnthropicTools(config.tools);
  const delegatedAgents = new Set<string>();

  let messages = buildMessages(history, userMessage);
  let iterations = 0;

  console.log(`[anthropic] tools for ${agentId}: [${tools.map(t => t.name).join(", ")}] (${tools.length} total)`);

  // Tool call loop (non-streaming)
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const anthropicModel = config.modelName || "claude-haiku-4-5-20251001";
    const response = await client.messages.create({
      model: anthropicModel,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    });

    logAnthropicMessageUsage(agentId, anthropicModel, response);

    console.log(`[anthropic] stop_reason=${response.stop_reason}, blocks=${response.content.length}, types=${response.content.map(b => b.type).join(",")}, tools_passed=${tools.length}`);

    // Check for tool use
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      // No tool calls — extract text and stream it
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === "text"
      );
      const fullText = textBlocks.map((b) => b.text).join("");

      if (fullText) {
        // Save to session
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
        return {
          text: fullText,
          delegatedFrom:
            delegatedAgents.size > 0
              ? Array.from(delegatedAgents).join(",")
              : undefined,
        };
      }

      // No text, no tools — stop
      break;
    }

    // Execute tool calls
    // First, add the assistant's response to messages
    messages = [
      ...messages,
      { role: "assistant" as const, content: response.content },
    ];

    // Track delegate_task calls
    for (const tc of toolUseBlocks) {
      if (tc.name === "delegate_task") {
        const args = tc.input as Record<string, string>;
        if (args?.agent) delegatedAgents.add(args.agent);
      }
    }

    // Execute all tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    const toolNames: string[] = [];

    for (const tc of toolUseBlocks) {
      const stringArgs = toolArgumentsToStringRecord(tc.name, tc.input);
      console.log(`[anthropic] tool_call: ${tc.name}`, JSON.stringify(stringArgs).slice(0, 200));
      const result = await executeTool(
        tc.name,
        stringArgs,
        userMessage,
        agentId
      );
      console.log(`[anthropic] tool_result: ${tc.name} =>`, result.slice(0, 200));
      toolNames.push(tc.name);
      toolResults.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: result,
      });
    }

    // Notify client which tools were used
    for (const tn of toolNames) {
      onChunk(`\n<!--toolUsed:${tn}-->`);
    }

    // Add tool results
    messages = [...messages, { role: "user" as const, content: toolResults }];
  }

  // If we got here without returning, do a final streaming call
  let fullText = "";

  const streamModel = config.modelName || "claude-haiku-4-5-20251001";
  const stream = client.messages.stream({
    model: streamModel,
    max_tokens: 4096,
    system: systemPrompt,
    messages,
    tools: tools.length > 0 ? tools : undefined,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      fullText += event.delta.text;
      onChunk(event.delta.text);
    }
  }

  try {
    const finalMsg = await stream.finalMessage();
    logAnthropicMessageUsage(agentId, streamModel, finalMsg);
  } catch {
    /* stream may not expose finalMessage in all SDK versions */
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
    consolidateSession(agentId, config.sessionFile).catch(() => {});
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
 * Autonomous (non-streaming) chat via Anthropic API — used by heartbeat.
 */
export async function autonomousChatAnthropic(
  agentId: string,
  triggerPrompt: string,
  options?: { maxHistory?: number; fromAgent?: string }
): Promise<string> {
  const client = getClient();
  const config = getAgentConfig(agentId);
  const systemPrompt = await getSystemPrompt(
    config.systemPromptFile,
    agentId,
    triggerPrompt
  );
  const history = getHistory(config.sessionFile);
  const tools = buildAnthropicTools(config.tools);

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

  let messages = buildMessages(recentHistory, triggerPrompt);
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const autoModel = config.modelName || "claude-haiku-4-5-20251001";
    const response = await client.messages.create({
      model: autoModel,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    });

    logAnthropicMessageUsage(agentId, autoModel, response);

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (toolUseBlocks.length > 0) {
      messages = [
        ...messages,
        { role: "assistant" as const, content: response.content },
      ];

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tc of toolUseBlocks) {
        const stringArgs = toolArgumentsToStringRecord(tc.name, tc.input);
        const result = await executeTool(
          tc.name,
          stringArgs,
          "[autonomous-heartbeat]",
          agentId
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: tc.id,
          content: result,
        });
      }

      messages = [...messages, { role: "user" as const, content: toolResults }];
      continue;
    }

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const replyText = textBlocks.map((b) => b.text).join("");

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
