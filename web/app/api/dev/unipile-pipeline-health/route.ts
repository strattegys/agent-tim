import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  observabilityApiAllowed,
  OBSERVABILITY_API_DISABLED_ERROR,
} from "@/lib/observability-gate";
import {
  query,
  getCrmDataPlatformConnectionLabel,
  crmResolvedHostPort,
} from "@/lib/db";
import { canUnipileReplayWriteToCrm } from "@/lib/unipile-replay-crm-guard";
import { isUnipileWebhookInboxEnabled } from "@/lib/unipile-webhook-inbox";
import { isUnipileConfigured } from "@/lib/unipile-profile";
import { isLinkedInAutomationDisabled } from "@/lib/linkedin-automation-gate";

export const runtime = "nodejs";

/**
 * GET — read-only Unipile + webhook queue snapshot for LOCALPROD / ops debugging.
 * Requires auth + same gate as Observation Post (see observability-gate).
 */
export async function GET() {
  if (!observabilityApiAllowed()) {
    return NextResponse.json({ error: OBSERVABILITY_API_DISABLED_ERROR }, { status: 404 });
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const replayGate = canUnipileReplayWriteToCrm();
  const crmTarget = crmResolvedHostPort();
  const inbox: {
    tablePresent: boolean;
    pending: number;
    pendingWithErrorNote: number;
    lastReceivedAt: string | null;
  } = {
    tablePresent: false,
    pending: 0,
    pendingWithErrorNote: 0,
    lastReceivedAt: null,
  };

  try {
    const rows = await query<{
      pending: string;
      failed_note: string;
      last_in: string | null;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE "processedAt" IS NULL)::text AS pending,
         COUNT(*) FILTER (
           WHERE "processedAt" IS NULL
             AND COALESCE(TRIM("processNote"), '') <> ''
         )::text AS failed_note,
         MAX("receivedAt")::text AS last_in
       FROM "_unipile_webhook_inbox"`
    );
    const r = rows[0];
    if (r) {
      inbox.tablePresent = true;
      inbox.pending = parseInt(r.pending, 10) || 0;
      inbox.pendingWithErrorNote = parseInt(r.failed_note, 10) || 0;
      inbox.lastReceivedAt = r.last_in;
    }
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
    if (code !== "42P01") {
      return NextResponse.json(
        {
          error: "crm_query_failed",
          message: e instanceof Error ? e.message : String(e),
          crmTarget,
          dataPlatformLabel: getCrmDataPlatformConnectionLabel(),
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    linkedinAutomationDisabled: isLinkedInAutomationDisabled(),
    crmTarget,
    dataPlatformLabel: getCrmDataPlatformConnectionLabel(),
    unipileApiConfigured: isUnipileConfigured(),
    durableWebhookInboxEnabled: isUnipileWebhookInboxEnabled(),
    unipileWebhookInbox: inbox,
    linkedinCatchupReplay: {
      allowed: replayGate.ok,
      skipReason: replayGate.ok ? null : replayGate.message,
      hint:
        replayGate.ok
          ? null
          : "On LOCALPROD against live droplet CRM, inbound replay is blocked unless you set UNIPILE_REPLAY_ALLOW_REMOTE_CRM=1 (dangerous on shared prod — use only on your laptop stack). Live webhooks still write to CRM when they hit the server URL Unipile calls.",
    },
  });
}
