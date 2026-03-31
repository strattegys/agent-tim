import type { ChatMessage } from "./session-store";

/** Optional extras for one-shot streaming turns (not persisted to session). */
export type ChatStreamExtraOptions = {
  /**
   * Prepended into the system prompt for this request only.
   * The stream API may merge Tim/Ghost queue context and lightweight `uiContext` here before calling providers.
   */
  workQueueContext?: string;
  /**
   * Cap how many prior session turns (user + model messages from JSONL) are passed to the model.
   * Omit or undefined = send full history. Used when work-pane focus supplies enough grounding (see CONTEXT-CONTRACTS.md).
   */
  sessionHistoryMaxMessages?: number;
};

/** Tim: work-queue row selected — keep recent chat turns; thread + CRM context live in workQueueContext. */
export const SESSION_HISTORY_FOCUS_TIM_WORK_ITEM = 24;

/** Suzi: focused intake / punch / reminder / note — tools + ephemeral block carry ids; trim session noise. */
export const SESSION_HISTORY_FOCUS_SUZI_WORK = 14;

/** Ghost: content-queue row selected. */
export const SESSION_HISTORY_FOCUS_GHOST_WORK = 24;

/** Server-side clamp for client-supplied sessionHistoryMaxMessages. */
export const SESSION_HISTORY_MAX_CAP = 500;

/**
 * Returns a suffix of `history` when `maxMessages` is a positive integer; otherwise the full array.
 */
export function applySessionHistoryLimit(
  history: ChatMessage[],
  maxMessages?: number
): ChatMessage[] {
  if (maxMessages == null || maxMessages <= 0) return history;
  if (history.length <= maxMessages) return history;
  return history.slice(-maxMessages);
}

/** Tim/Ghost work queue + LinkedIn CRM thread — single cap for merge + system prepend. */
export const WORK_QUEUE_EPHEMERAL_MAX_CHARS = 24_000;

export function appendEphemeralContext(
  systemPrompt: string,
  workQueueContext?: string
): string {
  const w = (workQueueContext ?? "").trim().slice(0, WORK_QUEUE_EPHEMERAL_MAX_CHARS);
  if (!w) return systemPrompt;
  // Prepend so models see collaboration rules before the long base prompt.
  return `## ACTIVE WORK CONTEXT (this message only — obey before default chat habits)

${w}

---

${systemPrompt}`;
}
