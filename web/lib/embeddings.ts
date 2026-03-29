import "server-only";

import { GoogleGenAI } from "@google/genai";
import { getGeminiApiKey } from "./gemini-api-key";
import { logGeminiEmbeddingUsage } from "./llm-usage-log";

/**
 * Suzi vector memory (`_memory.embedding`, pgvector 768). Uses Gemini because GroqCloud
 * does not expose text-embedding models on standard developer keys (verified: /v1/models has none).
 * When Groq ships embeddings with a 768-dim model for your account, you can add a Groq path here.
 */

const EMBEDDING_MODEL = "gemini-embedding-001";

let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  const key = getGeminiApiKey();
  if (!key) {
    throw new Error(
      "Gemini API key missing for embeddings. Set GEMINI_API_KEY in web/.env.local and restart dev / Docker web."
    );
  }
  if (!_ai) _ai = new GoogleGenAI({ apiKey: key });
  return _ai;
}

export type EmbedTextOptions = {
  /** Attributed in `_usage_event` / King (e.g. suzi, marni, system). */
  agentId?: string;
  /** Sub-kind for metadata (e.g. marni_kb_ingest, memory_search). */
  purpose?: string;
};

/** Embed a single text string. Returns a 768-dim float array. */
export async function embedText(text: string, opts?: EmbedTextOptions): Promise<number[]> {
  const ai = getAI();
  const result = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: { outputDimensionality: 768 },
  });
  const values = result.embeddings![0].values!;
  const meta = result.metadata as { billableCharacterCount?: number } | undefined;
  const billable =
    meta?.billableCharacterCount != null && Number.isFinite(meta.billableCharacterCount)
      ? Math.round(meta.billableCharacterCount)
      : null;
  logGeminiEmbeddingUsage({
    agentId: opts?.agentId ?? "embedding",
    model: EMBEDDING_MODEL,
    textLength: text.length,
    billableCharacterCount: billable,
    purpose: opts?.purpose,
  });
  return values;
}

/** Format a vector array as a pgvector literal string: '[0.1,0.2,...]' */
export function toPgVector(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
