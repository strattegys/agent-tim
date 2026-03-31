/**
 * In-memory ring buffer for Groq debug lines (Node runtime only).
 * Populated when GROQ_CHAT_DEBUG is effective; read from /api/dev/observability/logs.
 *
 * Buffer lives on `globalThis` (like observability toggles) so Next.js dev HMR / module reload
 * does not replace this module with a fresh empty array while the Tim lab keeps polling —
 * that mismatch made Groq session cards “flash once then vanish.”
 */

const MAX_ENTRIES = 120;
/** Large enough for one `[groq-debug-session]` blob (full tool loop) per user message. */
const MAX_CHARS_PER_ENTRY = 1_000_000;

export type GroqObservabilityEntry = { ts: number; text: string };

const GLOBAL_GROQ_BUFFER_KEY = "__ccGroqObservabilityLogBuffer" as const;

function getGroqBuffer(): GroqObservabilityEntry[] {
  const g = globalThis as unknown as Record<string, GroqObservabilityEntry[] | undefined>;
  if (!g[GLOBAL_GROQ_BUFFER_KEY]) {
    g[GLOBAL_GROQ_BUFFER_KEY] = [];
  }
  return g[GLOBAL_GROQ_BUFFER_KEY]!;
}

export function pushGroqObservabilityLog(text: string): void {
  const buf = getGroqBuffer();
  const clipped =
    text.length > MAX_CHARS_PER_ENTRY
      ? `${text.slice(0, MAX_CHARS_PER_ENTRY)}\n… [truncated for Observation buffer]`
      : text;
  buf.push({ ts: Date.now(), text: clipped });
  while (buf.length > MAX_ENTRIES) buf.shift();
}

export function getGroqObservabilityLogs(limit: number): GroqObservabilityEntry[] {
  const buf = getGroqBuffer();
  const n = Math.min(Math.max(0, limit), MAX_ENTRIES);
  if (n === 0) return [];
  return buf.slice(-n);
}

export function clearGroqObservabilityLogs(): void {
  getGroqBuffer().length = 0;
}
