/**
 * Drop legacy LinkedIn **connection** bell entries (now routed to Tim’s queue, not alerts).
 */
export function isLinkedInConnectionBellNoise(n: { type?: string; title?: string }): boolean {
  if (n.type !== "linkedin_inbound") return false;
  const t = (n.title || "").trim();
  if (t.startsWith("New LinkedIn Connection:")) return true;
  if (t.startsWith("Connection Accepted:")) return true;
  if (/^LinkedIn: .+ accepted \(inbox\)$/.test(t)) return true;
  return false;
}

/**
 * Inbound Unipile events that already create or update Tim workflow items (warm REPLY_DRAFT or
 * general LinkedIn inbox). Hiding them avoids duplicating the work queue in the right-rail Alerts list.
 */
export function isLinkedInInboundTimQueueDuplicate(n: { type?: string; title?: string }): boolean {
  if (n.type !== "linkedin_inbound") return false;
  const t = (n.title || "").trim();
  if (t.startsWith("Warm outreach:")) return true;
  if (/^LinkedIn: .+\(inbox/.test(t)) return true;
  return false;
}

/** Bell / dashboard: hide connection noise + Tim-queue duplicates for the same inbound stream. */
export function isLinkedInInboundHiddenFromAlerts(n: { type?: string; title?: string }): boolean {
  return isLinkedInConnectionBellNoise(n) || isLinkedInInboundTimQueueDuplicate(n);
}
