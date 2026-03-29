import "server-only";

import { recordUsageEvent } from "./usage-events";

type GeminiUsageMeta = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

/** Log one LLM completion for Command Central (first-party metering). */
export function logCommandCentralLlmUsage(params: {
  provider: "gemini" | "anthropic" | "groq";
  model: string;
  agentId: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  metadata?: Record<string, unknown>;
}): void {
  recordUsageEvent({
    surface: "llm",
    provider: params.provider,
    model: params.model,
    agent_id: params.agentId,
    input_tokens: params.inputTokens ?? null,
    output_tokens: params.outputTokens ?? null,
    metadata: params.metadata,
  });
}

export function logGeminiUsageFromResponse(
  agentId: string,
  model: string,
  response: { usageMetadata?: GeminiUsageMeta | null }
): void {
  const um = response.usageMetadata;
  if (!um) return;
  const input = um.promptTokenCount;
  const output =
    um.candidatesTokenCount ??
    (um.totalTokenCount != null && um.promptTokenCount != null
      ? Math.max(0, um.totalTokenCount - um.promptTokenCount)
      : undefined);
  logCommandCentralLlmUsage({
    provider: "gemini",
    model,
    agentId,
    inputTokens: input ?? null,
    outputTokens: output ?? null,
  });
}

/** Stream chunks may carry usage on the last chunk only. */
export function logGeminiUsageFromStreamChunk(
  agentId: string,
  model: string,
  chunk: unknown
): void {
  if (!chunk || typeof chunk !== "object") return;
  const o = chunk as { usageMetadata?: GeminiUsageMeta | null };
  if (o.usageMetadata) {
    logGeminiUsageFromResponse(agentId, model, { usageMetadata: o.usageMetadata });
  }
}

const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";

/**
 * Log one Gemini embedding call for King / `_usage_event` (same pipeline as Groq chat usage).
 * The Embed API often omits token counts; we record an input-token estimate (chars÷4, min 1) so
 * Cost-Usage totals stay comparable to LLM rows. Optional `billableCharacterCount` refines the estimate.
 */
export function logGeminiEmbeddingUsage(params: {
  agentId: string;
  model?: string;
  textLength: number;
  billableCharacterCount?: number | null;
  purpose?: string;
}): void {
  const model = params.model?.trim() || DEFAULT_EMBEDDING_MODEL;
  const basis =
    params.billableCharacterCount != null && params.billableCharacterCount > 0
      ? params.billableCharacterCount
      : Math.max(1, params.textLength);
  const inputTokens = Math.max(1, Math.ceil(basis / 4));
  logCommandCentralLlmUsage({
    provider: "gemini",
    model,
    agentId: params.agentId,
    inputTokens,
    outputTokens: null,
    metadata: {
      kind: "embedding",
      purpose: params.purpose ?? "unspecified",
      textChars: params.textLength,
      ...(params.billableCharacterCount != null
        ? { billableCharacterCount: params.billableCharacterCount }
        : {}),
    },
  });
}
