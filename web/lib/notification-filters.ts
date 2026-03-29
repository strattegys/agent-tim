/**
 * Drop legacy LinkedIn **connection** bell entries (now routed to Tim’s queue, not alerts).
 * Keep other `linkedin_inbound` rows (messages, warm outreach, etc.).
 */
export function isLinkedInConnectionBellNoise(n: { type?: string; title?: string }): boolean {
  if (n.type !== "linkedin_inbound") return false;
  const t = (n.title || "").trim();
  if (t.startsWith("New LinkedIn Connection:")) return true;
  if (t.startsWith("Connection Accepted:")) return true;
  if (/^LinkedIn: .+ accepted \(inbox\)$/.test(t)) return true;
  return false;
}
