import { WORK_QUEUE_EPHEMERAL_MAX_CHARS } from "@/lib/chat-stream-options";
import { getObservabilityToggleEffective } from "@/lib/observability-runtime";

const LINKEDIN_THREAD_HEADING = "## LinkedIn thread on this workflow item";
const SERVER_THREAD_HEADING = "### LinkedIn thread (CRM artifacts";

/** Snapshot streamed to the client when `TIM_CHAT_CONTEXT_DEBUG=1` (Tim only). */
export type TimContextDebugSnapshot = {
  summaryLine: string;
  timWorkQueueChars: number;
  uiContextChars: number;
  serverWarmAugChars: number;
  mergedChars: number;
  mergedCappedTo: number;
  mergedWasTruncated: boolean;
  hasLinkedInThreadHeadingInTim: boolean;
  hasServerWarmThread: boolean;
  /** Exact strings passed into `appendEphemeralContext` (may contain CRM/thread text). */
  timWorkContext: string;
  uiContext: string;
  /** Server-built warm/package/thread/KB block (may be empty). */
  serverWarmAugmentation: string;
};

export function isTimChatContextDebugEnabled(): boolean {
  return getObservabilityToggleEffective("TIM_CHAT_CONTEXT_DEBUG");
}

export function buildTimContextDebugSnapshot(
  tim: string,
  ui: string,
  serverWarmAugmentation = ""
): TimContextDebugSnapshot {
  const timWorkContext = tim;
  const uiContext = ui;
  const serverWarm = serverWarmAugmentation.trim();
  const merged = [timWorkContext, uiContext, serverWarm].filter(Boolean).join("\n\n---\n\n");
  const mergedWasTruncated = merged.length > WORK_QUEUE_EPHEMERAL_MAX_CHARS;
  const mergedCappedTo = mergedWasTruncated
    ? WORK_QUEUE_EPHEMERAL_MAX_CHARS
    : merged.length;
  const hasLinkedInThreadHeadingInTim = timWorkContext.includes(LINKEDIN_THREAD_HEADING);
  const hasServerWarmThread =
    serverWarm.includes(SERVER_THREAD_HEADING) || serverWarm.includes("LinkedIn thread (CRM");

  const parts = [
    `Tim work-queue context: ${timWorkContext.length} chars`,
    `UI context: ${uiContext.length} chars`,
    `Server warm aug: ${serverWarm.length} chars`,
    `Merged (before system prompt): ${merged.length} chars`,
    mergedWasTruncated
      ? `⚠ Truncated to ${mergedCappedTo} chars in appendEphemeralContext`
      : `No truncation (≤ ${WORK_QUEUE_EPHEMERAL_MAX_CHARS})`,
    hasLinkedInThreadHeadingInTim
      ? "Client LinkedIn thread block: present"
      : "Client LinkedIn thread block: omitted or empty",
    hasServerWarmThread ? "Server CRM thread: present" : "Server CRM thread: missing",
  ];

  return {
    summaryLine: parts.join(" · "),
    timWorkQueueChars: timWorkContext.length,
    uiContextChars: uiContext.length,
    serverWarmAugChars: serverWarm.length,
    mergedChars: merged.length,
    mergedCappedTo,
    mergedWasTruncated,
    hasLinkedInThreadHeadingInTim,
    hasServerWarmThread,
    timWorkContext,
    uiContext,
    serverWarmAugmentation: serverWarm,
  };
}
