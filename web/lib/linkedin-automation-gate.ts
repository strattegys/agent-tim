/**
 * Master pause for Unipile → LinkedIn inbound automation (webhooks, inbox drain, catch-up, connection polling).
 * Set LINKEDIN_AUTOMATION_DISABLED=1 in web/.env.local and restart the web process.
 */

export function isLinkedInAutomationDisabled(): boolean {
  const v = process.env.LINKEDIN_AUTOMATION_DISABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
