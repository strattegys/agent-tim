/**
 * In-memory ring buffer for Friday lab — CRM workflow / cron trace lines (Node only).
 * Read via GET /api/dev/observability/logs?category=workflow (auth + observability gate).
 */

import { observabilityApiAllowed } from "@/lib/observability-gate";

const MAX_ENTRIES = 120;
const MAX_CHARS_PER_ENTRY = 24_000;

export type WorkflowObservabilityEntry = { ts: number; text: string; seq?: number };

const GLOBAL_KEY = "__ccWorkflowObservabilityLogBuffer" as const;
const GLOBAL_SEQ_KEY = "__ccWorkflowObservabilityLogSeq" as const;

function nextSeq(): number {
  const g = globalThis as unknown as Record<string, number | undefined>;
  const n = (g[GLOBAL_SEQ_KEY] ?? 0) + 1;
  g[GLOBAL_SEQ_KEY] = n;
  return n;
}

function getBuffer(): WorkflowObservabilityEntry[] {
  const g = globalThis as unknown as Record<string, WorkflowObservabilityEntry[] | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = [];
  return g[GLOBAL_KEY]!;
}

function bufferWritesEnabled(): boolean {
  return observabilityApiAllowed();
}

/** Structured workflow / ops event (JSON payload after `[workflow-trace]` prefix). */
export function pushWorkflowObservabilityEvent(
  kind: string,
  detail: Record<string, unknown> = {}
): void {
  if (!bufferWritesEnabled()) return;
  const payload = JSON.stringify({ kind, ...detail });
  const line = `[workflow-trace] ${payload}`;
  const clipped =
    line.length > MAX_CHARS_PER_ENTRY
      ? `${line.slice(0, MAX_CHARS_PER_ENTRY)}\n… [truncated]`
      : line;
  const buf = getBuffer();
  buf.push({ ts: Date.now(), text: clipped, seq: nextSeq() });
  while (buf.length > MAX_ENTRIES) buf.shift();
}

export function getWorkflowObservabilityLogs(limit: number): WorkflowObservabilityEntry[] {
  const buf = getBuffer();
  const n = Math.min(Math.max(0, limit), MAX_ENTRIES);
  if (n === 0) return [];
  const slice = buf.slice(-n);
  return [...slice].sort((a, b) => {
    const dq = (b.seq ?? 0) - (a.seq ?? 0);
    if (dq !== 0) return dq;
    return b.ts - a.ts;
  });
}

export function clearWorkflowObservabilityLogs(): void {
  getBuffer().length = 0;
}
