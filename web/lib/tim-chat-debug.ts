import { WORK_QUEUE_EPHEMERAL_MAX_CHARS } from "@/lib/chat-stream-options";
import { getObservabilityToggleEffective } from "@/lib/observability-runtime";

const LINKEDIN_THREAD_HEADING = "## LinkedIn thread on this workflow item";

/** Snapshot streamed to the client when `TIM_CHAT_CONTEXT_DEBUG=1` (Tim only). */
export type TimContextDebugSnapshot = {
  summaryLine: string;
  timWorkQueueChars: number;
  uiContextChars: number;
  mergedChars: number;
  mergedCappedTo: number;
  mergedWasTruncated: boolean;
  hasLinkedInThreadHeadingInTim: boolean;
  /** Exact strings passed into `appendEphemeralContext` (may contain CRM/thread text). */
  timWorkContext: string;
  uiContext: string;
};

export function isTimChatContextDebugEnabled(): boolean {
  return getObservabilityToggleEffective("TIM_CHAT_CONTEXT_DEBUG");
}

export function buildTimContextDebugSnapshot(tim: string, ui: string): TimContextDebugSnapshot {
  const timWorkContext = tim;
  const uiContext = ui;
  const merged = [timWorkContext, uiContext].filter(Boolean).join("\n\n---\n\n");
  const mergedWasTruncated = merged.length > WORK_QUEUE_EPHEMERAL_MAX_CHARS;
  const mergedCappedTo = mergedWasTruncated
    ? WORK_QUEUE_EPHEMERAL_MAX_CHARS
    : merged.length;
  const hasLinkedInThreadHeadingInTim = timWorkContext.includes(LINKEDIN_THREAD_HEADING);

  const parts = [
    `Tim work-queue context: ${timWorkContext.length} chars`,
    `UI context: ${uiContext.length} chars`,
    `Merged (before system prompt): ${merged.length} chars`,
    mergedWasTruncated
      ? `⚠ Truncated to ${mergedCappedTo} chars in appendEphemeralContext`
      : `No truncation (≤ ${WORK_QUEUE_EPHEMERAL_MAX_CHARS})`,
    hasLinkedInThreadHeadingInTim
      ? "LinkedIn thread block: present in Tim context"
      : "LinkedIn thread block: MISSING (transcript not merged or empty)",
  ];

  return {
    summaryLine: parts.join(" · "),
    timWorkQueueChars: timWorkContext.length,
    uiContextChars: uiContext.length,
    mergedChars: merged.length,
    mergedCappedTo,
    mergedWasTruncated,
    hasLinkedInThreadHeadingInTim,
    timWorkContext,
    uiContext,
  };
}
