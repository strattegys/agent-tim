/**
 * In-memory ring buffer for Tim lab Unipile visibility (Node runtime only).
 * Read via GET /api/dev/observability/logs?category=unipile (auth + observability gate).
 *
 * Writes when Observation Post is allowed (see observability-gate) or TIM_LAB_UNIPILE_LOG=1,
 * so API pulls and sends are logged whenever the dock can read them — not only on webhooks.
 */

import { observabilityApiAllowed } from "@/lib/observability-gate";

const MAX_ENTRIES = 80;
const MAX_CHARS_PER_ENTRY = 32_000;

export type UnipileObservabilityEntry = { ts: number; text: string };

/** Same globalThis pattern as Groq buffer — survives dev HMR so Tim lab polling stays consistent. */
const GLOBAL_UNIPILE_BUFFER_KEY = "__ccUnipileObservabilityLogBuffer" as const;

function getUnipileBuffer(): UnipileObservabilityEntry[] {
  const g = globalThis as unknown as Record<string, UnipileObservabilityEntry[] | undefined>;
  if (!g[GLOBAL_UNIPILE_BUFFER_KEY]) {
    g[GLOBAL_UNIPILE_BUFFER_KEY] = [];
  }
  return g[GLOBAL_UNIPILE_BUFFER_KEY]!;
}

export function unipileObservabilityBufferEnabled(): boolean {
  if (observabilityApiAllowed()) return true;
  const v = process.env.TIM_LAB_UNIPILE_LOG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function pushUnipileObservabilityLog(text: string): void {
  if (!unipileObservabilityBufferEnabled()) return;
  const clipped =
    text.length > MAX_CHARS_PER_ENTRY
      ? `${text.slice(0, MAX_CHARS_PER_ENTRY)}\n… [truncated for Unipile lab buffer]`
      : text;
  const buf = getUnipileBuffer();
  buf.push({ ts: Date.now(), text: clipped });
  while (buf.length > MAX_ENTRIES) buf.shift();
}

export function getUnipileObservabilityLogs(limit: number): UnipileObservabilityEntry[] {
  const buf = getUnipileBuffer();
  const n = Math.min(Math.max(0, limit), MAX_ENTRIES);
  if (n === 0) return [];
  return buf.slice(-n);
}

export function clearUnipileObservabilityLogs(): void {
  getUnipileBuffer().length = 0;
}
