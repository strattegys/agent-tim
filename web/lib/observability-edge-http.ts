/**
 * Edge-safe ring buffer for incoming /api requests seen by middleware.
 * May not share memory with Node handlers in some deployments; still useful in many dev setups.
 */

const GKEY = "__cc_obs_edge_http";

export type EdgeHttpObservabilityEntry = { ts: number; method: string; pathname: string };

function buffer(): EdgeHttpObservabilityEntry[] {
  const g = globalThis as unknown as Record<string, EdgeHttpObservabilityEntry[] | undefined>;
  if (!g[GKEY]) g[GKEY] = [];
  return g[GKEY]!;
}

const MAX = 300;

export function pushEdgeApiRequest(method: string, pathname: string): void {
  const buf = buffer();
  buf.push({ ts: Date.now(), method: method.toUpperCase(), pathname });
  while (buf.length > MAX) buf.shift();
}

export function getEdgeApiRequests(limit: number): EdgeHttpObservabilityEntry[] {
  const buf = buffer();
  const n = Math.min(Math.max(0, limit), MAX);
  if (n === 0) return [];
  return buf.slice(-n);
}

export function clearEdgeApiRequests(): void {
  const g = globalThis as unknown as Record<string, EdgeHttpObservabilityEntry[] | undefined>;
  g[GKEY] = [];
}
