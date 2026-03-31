/**
 * Shared gate for Observation Post APIs and middleware-side capture.
 * Safe for Edge (env only) and Node.
 */
function envEnabled(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Shown when GET/POST /api/dev/observability* returns 404 (gate off). */
export const OBSERVABILITY_API_DISABLED_ERROR =
  "Observation Post is off for this server. Set OBSERVATION_POST_API=1 in web/.env.local (recommended for Docker local prod), run next dev, or set DEV_UNIPILE_INBOUND_REPLAY=1. Restart the web process after changing env.";

export function observabilityApiAllowed(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  if (envEnabled("OBSERVATION_POST_API")) return true;
  return envEnabled("DEV_UNIPILE_INBOUND_REPLAY");
}
