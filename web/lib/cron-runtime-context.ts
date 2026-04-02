import "server-only";

import { getLocalRuntimeLabel } from "./app-brand";

/**
 * Default public URL for this Command Central tenant (matches docker-compose.yml AUTH_URL on the droplet).
 * Override with CC_HOSTED_APP_URL for staging or other hosts.
 */
const DEFAULT_HOSTED_COMMAND_CENTRAL_ORIGIN = "https://stratt-central.b2bcontentartist.com";

/**
 * Laptop stacks and `next dev`: do not run node-cron. The Friday Cron tab loads
 * live last-run data from the hosted Command Central app (see `/api/cron-status`).
 */
export function isCommandCentralLocalRuntime(): boolean {
  return getLocalRuntimeLabel() !== null || process.env.NODE_ENV === "development";
}

/** Production origin for server-to-server cron status (no trailing path). */
export function getHostedCommandCentralOrigin(): string | null {
  const raw = process.env.CC_HOSTED_APP_URL?.trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      return isCommandCentralLocalRuntime() ? DEFAULT_HOSTED_COMMAND_CENTRAL_ORIGIN : null;
    }
  }
  if (isCommandCentralLocalRuntime()) {
    return DEFAULT_HOSTED_COMMAND_CENTRAL_ORIGIN;
  }
  return null;
}

/** Same value as `INTERNAL_API_KEY` on the hosted server, unless overridden. */
export function resolveCronStatusInternalKey(): string | undefined {
  const k =
    process.env.CC_HOSTED_INTERNAL_API_KEY?.trim() || process.env.INTERNAL_API_KEY?.trim();
  return k || undefined;
}
