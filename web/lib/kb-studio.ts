/** Knowledge Studio (topics + vector chunks) — which agentIds the API and UI allow. */

export const KB_STUDIO_AGENT_IDS = ["marni", "tim"] as const;
export type KbStudioAgentId = (typeof KB_STUDIO_AGENT_IDS)[number];

export function isKbStudioAgentId(s: string): s is KbStudioAgentId {
  return (KB_STUDIO_AGENT_IDS as readonly string[]).includes(s);
}

/** Parse `agentId` query/body value; empty → defaultAgent. */
export function resolveKbStudioAgentId(
  raw: string | null | undefined,
  defaultAgent: KbStudioAgentId = "marni"
): { ok: true; agentId: KbStudioAgentId } | { ok: false; error: string } {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "") return { ok: true, agentId: defaultAgent };
  if (isKbStudioAgentId(t)) return { ok: true, agentId: t };
  return { ok: false, error: "agentId must be marni or tim" };
}
