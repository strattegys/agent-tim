/**
 * In-memory ring buffer for Groq debug lines (Node runtime only).
 * Populated when GROQ_CHAT_DEBUG is effective; read from /api/dev/observability/logs.
 */

const MAX_ENTRIES = 120;
const MAX_CHARS_PER_ENTRY = 48_000;

export type GroqObservabilityEntry = { ts: number; text: string };

const groqBuffer: GroqObservabilityEntry[] = [];

export function pushGroqObservabilityLog(text: string): void {
  const clipped =
    text.length > MAX_CHARS_PER_ENTRY
      ? `${text.slice(0, MAX_CHARS_PER_ENTRY)}\n… [truncated for Observation buffer]`
      : text;
  groqBuffer.push({ ts: Date.now(), text: clipped });
  while (groqBuffer.length > MAX_ENTRIES) groqBuffer.shift();
}

export function getGroqObservabilityLogs(limit: number): GroqObservabilityEntry[] {
  const n = Math.min(Math.max(0, limit), MAX_ENTRIES);
  if (n === 0) return [];
  return groqBuffer.slice(-n);
}

export function clearGroqObservabilityLogs(): void {
  groqBuffer.length = 0;
}
