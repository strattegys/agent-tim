/**
 * Periodic Unipile → CRM catch-up: release stuck dedupe rows, replay recent inbound DMs.
 * Supplements live webhooks so missed or half-processed messages still reach Tim’s queue.
 */
import {
  listInboundReceiptOrphans,
  releaseAllStaleUnprocessedInboundReceipts,
} from "@/lib/linkedin-inbound-receipt";
import { replayRecentUnipileInboundAsWebhooks } from "@/lib/unipile-inbound-replay";
import { canUnipileReplayWriteToCrm } from "@/lib/unipile-replay-crm-guard";
import {
  countPendingUnipileWebhookInbox,
  drainUnipileWebhookInbox,
} from "@/lib/unipile-webhook-inbox";

export type LinkedInInboundCatchupResult = {
  ok: boolean;
  skipped?: string;
  webhookInboxPendingStart?: number;
  webhookInboxProcessed: number;
  webhookInboxFailed: number;
  staleReleased: number;
  orphanRowsSample: number;
  replayed: number;
  inboundCandidates: number;
  chatsListed: number;
  replayError?: string;
};

const STALE_RECEIPT_MINUTES = 20;

function catchupLookbackHours(): number {
  const raw = process.env.LINKEDIN_INBOUND_CATCHUP_HOURS?.trim();
  const n = raw ? parseInt(raw, 10) : 72;
  if (!Number.isFinite(n) || n < 1) return 72;
  return Math.min(168, n);
}

/**
 * Safe to call from node-cron inside the Next.js server (same env as webhooks).
 * Set `LINKEDIN_INBOUND_CATCHUP_CRON=0` to disable.
 */
export async function runLinkedInInboundCatchupCron(): Promise<LinkedInInboundCatchupResult> {
  const disabled =
    process.env.LINKEDIN_INBOUND_CATCHUP_CRON?.trim() === "0" ||
    process.env.LINKEDIN_INBOUND_CATCHUP_CRON?.trim().toLowerCase() === "false";
  if (disabled) {
    return {
      ok: true,
      skipped: "LINKEDIN_INBOUND_CATCHUP_CRON disabled",
      webhookInboxProcessed: 0,
      webhookInboxFailed: 0,
      staleReleased: 0,
      orphanRowsSample: 0,
      replayed: 0,
      inboundCandidates: 0,
      chatsListed: 0,
    };
  }

  const crmOk = canUnipileReplayWriteToCrm();
  if (!crmOk.ok) {
    return {
      ok: true,
      skipped: crmOk.message,
      webhookInboxProcessed: 0,
      webhookInboxFailed: 0,
      staleReleased: 0,
      orphanRowsSample: 0,
      replayed: 0,
      inboundCandidates: 0,
      chatsListed: 0,
    };
  }

  let webhookPendingStart = 0;
  let webhookInboxProcessed = 0;
  let webhookInboxFailed = 0;
  try {
    webhookPendingStart = await countPendingUnipileWebhookInbox();
    const inboxDrain = await drainUnipileWebhookInbox(100);
    webhookInboxProcessed = inboxDrain.processed;
    webhookInboxFailed = inboxDrain.failed;
  } catch (e) {
    console.warn("[linkedin-inbound-catchup] webhook inbox drain:", e);
  }

  let orphanSample = 0;
  try {
    const orphans = await listInboundReceiptOrphans({
      olderThanMinutes: STALE_RECEIPT_MINUTES,
      limit: 50,
    });
    orphanSample = orphans.length;
  } catch {
    /* missing columns / table — listInboundReceiptOrphans returns [] */
  }

  const staleReleased = await releaseAllStaleUnprocessedInboundReceipts(STALE_RECEIPT_MINUTES);

  const lookbackH = catchupLookbackHours();
  const since = new Date(Date.now() - lookbackH * 3600 * 1000).toISOString();
  const replay = await replayRecentUnipileInboundAsWebhooks({
    maxChats: 120,
    messagesPerChat: 30,
    maxInbound: 100,
    dryRun: false,
    messageAfterIso: since,
  });

  if (!replay.ok) {
    console.warn("[linkedin-inbound-catchup] replay failed:", replay.error);
    return {
      ok: false,
      webhookInboxPendingStart: webhookPendingStart,
      webhookInboxProcessed,
      webhookInboxFailed,
      staleReleased,
      orphanRowsSample: orphanSample,
      replayed: 0,
      inboundCandidates: 0,
      chatsListed: 0,
      replayError: replay.error,
    };
  }

  const failed = replay.items.filter((i) => !i.ok);
  if (failed.length > 0) {
    console.warn(
      `[linkedin-inbound-catchup] ${failed.length} replay row(s) failed (first: ${failed[0]?.error || "unknown"})`
    );
  }

  console.log(
    `[linkedin-inbound-catchup] inbox pendingStart=${webhookPendingStart} inboxProcessed=${webhookInboxProcessed} inboxFailed=${webhookInboxFailed} staleReleased=${staleReleased} orphanSample=${orphanSample} replayed=${replay.replayed}/${replay.inboundCandidates} chatsListed=${replay.chatsListed} lookbackH=${lookbackH}`
  );

  return {
    ok: true,
    webhookInboxPendingStart: webhookPendingStart,
    webhookInboxProcessed,
    webhookInboxFailed,
    staleReleased,
    orphanRowsSample: orphanSample,
    replayed: replay.replayed,
    inboundCandidates: replay.inboundCandidates,
    chatsListed: replay.chatsListed,
  };
}
