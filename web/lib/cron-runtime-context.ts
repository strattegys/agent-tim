import "server-only";

import { getLocalRuntimeLabel } from "./app-brand";

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
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Same value as `INTERNAL_API_KEY` on the hosted server, unless overridden. */
export function resolveCronStatusInternalKey(): string | undefined {
  const k =
    process.env.CC_HOSTED_INTERNAL_API_KEY?.trim() || process.env.INTERNAL_API_KEY?.trim();
  return k || undefined;
}
