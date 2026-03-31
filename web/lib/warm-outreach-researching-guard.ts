/**
 * Warm outreach — shared sentinel for discovery placeholder rows on `person.jobTitle`.
 * (Same string as `insertWarmOutreachDiscoveryItem` / package activate.)
 */

export const WARM_OUTREACH_PLACEHOLDER_JOB_TITLE = "Warm outreach — awaiting contact details";

export function isWarmOutreachPlaceholderJobTitle(value: string | null | undefined): boolean {
  if (value == null || !String(value).trim()) return false;
  return String(value).trim().toLowerCase() === WARM_OUTREACH_PLACEHOLDER_JOB_TITLE.toLowerCase();
}

/** Auto-stamped on `person.jobTitle` when LinkedIn inbound creates the CRM row (`linkedin-general-inbox`). */
export function isLinkedInInboundAutoJobTitle(value: string | null | undefined): boolean {
  if (value == null || !String(value).trim()) return false;
  const t = String(value).trim().toLowerCase();
  return t.startsWith("linkedin inbound (auto");
}
