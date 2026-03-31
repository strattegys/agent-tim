/**
 * Unipile inbound replay calls `handleUnipileWebhook`, which inserts CRM notes / workflow artifacts.
 * Laptop `.env.local` often tunnels `CRM_DB_HOST=host.docker.internal` to production — replay must not
 * write there unless the operator explicitly opts in.
 *
 * Also allows hostname **crm-db** (bundled Postgres in docker-compose.dev.yml / production compose).
 */

function normalizedCrmHost(): string {
  return (process.env.CRM_DB_HOST || "127.0.0.1").trim().toLowerCase();
}

function isLoopbackCrmHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** Compose service name for the CRM container on the Docker network (local dev + production stack). */
function isBundledComposeCrmHost(host: string): boolean {
  return host === "crm-db";
}

/**
 * When false, `replayRecentUnipileInboundAsWebhooks` must not call `handleUnipileWebhook` (writes).
 * Dry-run only lists messages from Unipile and skips this check.
 */
export function canUnipileReplayWriteToCrm(): { ok: true } | { ok: false; message: string } {
  if (process.env.UNIPILE_REPLAY_ALLOW_REMOTE_CRM === "1") {
    return { ok: true };
  }

  if (!process.env.CRM_DB_PASSWORD?.trim()) {
    return {
      ok: false,
      message:
        "Unipile replay with writes requires CRM_DB_PASSWORD (real Postgres). Empty password uses .dev-store, which does not mirror production queue behavior. Use dryRun, or point CRM_DB_* at a local database.",
    };
  }

  const host = normalizedCrmHost();
  if (isLoopbackCrmHost(host) || isBundledComposeCrmHost(host)) {
    return { ok: true };
  }

  const display = process.env.CRM_DB_HOST?.trim() || "(default 127.0.0.1)";
  return {
    ok: false,
    message: [
      `Unipile replay refused: CRM_DB_HOST=${display} is not loopback or crm-db.`,
      "Replay creates workflow rows and artifacts in whatever database CRM_DB_* points to.",
      "For bundled local Postgres (Docker dev), use default compose (CRM_DB_HOST=crm-db) or set CRM_DB_HOST=127.0.0.1 and CRM_DB_PORT=25432 on the host.",
      "To override for a non-production remote DB, set UNIPILE_REPLAY_ALLOW_REMOTE_CRM=1 for that shell only — never on production servers.",
    ].join(" "),
  };
}
