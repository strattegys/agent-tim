import { GoogleGenAI, Type } from "@google/genai";
import { getSystemPrompt } from "./system-prompt";
import { toolDeclarations, executeTool } from "./tools";
import { getHistory, addMessage, type ChatMessage } from "./session-store";
import { getAgentConfig } from "./agent-config";

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
  userMessage: string
): Promise<string> {
  const ai = getClient();
  const config = getAgentConfig(agentId);
  const systemPrompt = getSystemPrompt(config.systemPromptFile);
  const history = getHistory(config.sessionFile);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents: any[] = history.map((msg: ChatMessage) => ({
    role: msg.role,
    parts: [{ text: msg.text }],
  }));
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  const tools = buildGeminiTools(config.tools);

  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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

      const functionResponses = functionCalls.map((fc) => {
        const result = executeTool(
          fc.functionCall!.name!,
          (fc.functionCall!.args as Record<string, string>) || {}
        );
        return {
          functionResponse: {
            name: fc.functionCall!.name!,
            response: { result },
          },
        };
      });

      contents.push({
        role: "user",
        parts: functionResponses,
      });

      continue;
    }

    const textParts = parts.filter((p) => p.text);
    const replyText = textParts.map((p) => p.text).join("");

    if (replyText) {
      addMessage(config.sessionFile, {
        role: "user",
        text: userMessage,
        timestamp: Date.now(),
      });
      addMessage(config.sessionFile, {
        role: "model",
        text: replyText,
        timestamp: Date.now(),
      });
      return replyText;
    }

    break;
  }

  return "I couldn't generate a response. Please try again.";
}
