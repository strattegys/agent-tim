/**
 * In-process pub/sub so open SSE connections can refresh right after CRM mutations
 * in this Node process (no Redis). Multi-instance: only clients on the same instance
 * get immediate pushes; others rely on the stream safety interval or navigation.
 *
 * Emitters: CRM API routes (resolve, packages, workflow-items, …) and
 * `executeTool` after successful agent tool runs (see lib/tools/executor.ts).
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe from /api/dashboard-stream; returns unsubscribe. */
export function subscribeDashboardSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Call after CRM writes that affect dashboard badges / human-task counts. */
export function notifyDashboardSyncChange(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore listener errors */
    }
  }
}
