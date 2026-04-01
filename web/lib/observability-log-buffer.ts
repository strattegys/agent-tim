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

export type GroqObservabilityEntry = { ts: number; text: string; seq?: number };

const GLOBAL_GROQ_BUFFER_KEY = "__ccGroqObservabilityLogBuffer" as const;
const GLOBAL_GROQ_SEQ_KEY = "__ccGroqObservabilityLogSeq" as const;

function nextGroqSeq(): number {
  const g = globalThis as unknown as Record<string, number | undefined>;
  const n = (g[GLOBAL_GROQ_SEQ_KEY] ?? 0) + 1;
  g[GLOBAL_GROQ_SEQ_KEY] = n;
  return n;
}

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
  buf.push({ ts: Date.now(), text: clipped, seq: nextGroqSeq() });
  while (buf.length > MAX_ENTRIES) buf.shift();
}

export function getGroqObservabilityLogs(limit: number): GroqObservabilityEntry[] {
  const buf = getGroqBuffer();
  const n = Math.min(Math.max(0, limit), MAX_ENTRIES);
  if (n === 0) return [];
  const slice = buf.slice(-n);
  return [...slice].sort((a, b) => {
    const dq = (b.seq ?? 0) - (a.seq ?? 0);
    if (dq !== 0) return dq;
    return b.ts - a.ts;
  });
}

export function clearGroqObservabilityLogs(): void {
  getGroqBuffer().length = 0;
}
