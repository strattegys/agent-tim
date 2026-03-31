/**
 * Shared gate for Observation Post APIs and middleware-side capture.
 * Safe for Edge (env only) and Node.
 */
export function observabilityApiAllowed(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.DEV_UNIPILE_INBOUND_REPLAY === "1";
}
