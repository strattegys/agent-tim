/** Optional extras for one-shot streaming turns (not persisted to session). */
export type ChatStreamExtraOptions = {
  /** Prepended into system prompt for this request only (e.g. Tim work queue selection). */
  workQueueContext?: string;
};

const MAX_CONTEXT = 12_000;

export function appendEphemeralContext(
  systemPrompt: string,
  workQueueContext?: string
): string {
  const w = (workQueueContext ?? "").trim().slice(0, MAX_CONTEXT);
  if (!w) return systemPrompt;
  // Prepend so models see collaboration rules before the long base prompt.
  return `## ACTIVE WORK CONTEXT (this message only — obey before default chat habits)

${w}

---

${systemPrompt}`;
}
