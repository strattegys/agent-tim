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
  "Observation Post is off for this server. Set OBSERVATION_POST_API=1 in web/.env.local (Docker LOCALPROD / production NODE_ENV), use next dev (traces on by default), set CC_FORCE_SERVER_CRON=1 when forcing local timers with NODE_ENV=production, or set DEV_UNIPILE_INBOUND_REPLAY=1. Restart the web process after changing env.";

export function observabilityApiAllowed(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  if (envEnabled("OBSERVATION_POST_API")) return true;
  /** Local “run hosted crons here” — same visibility expectation as Observation Post + workflow traces. */
  if (process.env.CC_FORCE_SERVER_CRON?.trim() === "1") return true;
  return envEnabled("DEV_UNIPILE_INBOUND_REPLAY");
}
