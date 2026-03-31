import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";
import { replayRecentUnipileInboundAsWebhooks } from "@/lib/unipile-inbound-replay";

export const runtime = "nodejs";

function replayAllowed(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.DEV_UNIPILE_INBOUND_REPLAY === "1";
}

/**
 * POST /api/dev/replay-unipile-inbound
 *
 * Authenticated dev helper: pulls recent LinkedIn chats from Unipile, selects up to `maxInbound`
 * inbound (non-self) messages, and runs each through the same handler as the real Unipile webhook
 * — CRM notes, warm-outreach auto-reply transition, or Tim general inbox queue.
 *
 * Enabled when NODE_ENV=development, or set DEV_UNIPILE_INBOUND_REPLAY=1 (e.g. Docker dev).
 * Writes are refused unless CRM_DB_HOST is loopback (127.0.0.1 / localhost / ::1), or
 * UNIPILE_REPLAY_ALLOW_REMOTE_CRM=1 is set for that process (use only for intentional staging).
 *
 * Body (JSON, optional):
 * - maxChats (default 30) — how many chats to list (higher = better chance to fill maxInbound)
 * - messagesPerChat (default 25) — messages fetched per chat
 * - maxInbound (default 10) — cap on inbound messages to replay (newest among collected)
 * - dryRun (default false) — if true, only returns previews without writing CRM / queue
 *
 * From the browser console while logged in:
 * fetch("/api/dev/replay-unipile-inbound", {
 *   method: "POST",
 *   headers: { "Content-Type": "application/json" },
 *   credentials: "include",
 *   body: JSON.stringify({ maxInbound: 10, dryRun: true }),
 * }).then((r) => r.json()).then(console.log);
 */
export async function POST(req: NextRequest) {
  if (!replayAllowed()) {
    return NextResponse.json(
      { error: "Not available (enable development or DEV_UNIPILE_INBOUND_REPLAY=1)" },
      { status: 404 }
    );
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      body = (await req.json()) as Record<string, unknown>;
    }
  } catch {
    /* use defaults */
  }

  const maxChats =
    typeof body.maxChats === "number" && Number.isFinite(body.maxChats)
      ? body.maxChats
      : 30;
  const messagesPerChat =
    typeof body.messagesPerChat === "number" && Number.isFinite(body.messagesPerChat)
      ? body.messagesPerChat
      : 25;
  const maxInbound =
    typeof body.maxInbound === "number" && Number.isFinite(body.maxInbound)
      ? body.maxInbound
      : 10;
  const dryRun = body.dryRun === true;

  const result = await replayRecentUnipileInboundAsWebhooks({
    maxChats,
    messagesPerChat,
    maxInbound,
    dryRun,
  });

  if (!result.ok && result.error) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        chatsListed: result.chatsListed,
        inboundCandidates: result.inboundCandidates,
      },
      { status: 400 }
    );
  }

  if (!dryRun && result.replayed > 0) {
    notifyDashboardSyncChange();
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    hint:
      dryRun === false
        ? "Replaying the same Unipile messages again duplicates CRM notes and inbox artifacts; use dryRun first or lower limits."
        : "Set dryRun:false to run handleUnipileWebhook for each preview (writes CRM + may update Tim queue).",
    chatsListed: result.chatsListed,
    inboundCandidates: result.inboundCandidates,
    replayed: result.replayed,
    skippedOutbound: result.skippedOutbound,
    items: result.items,
  });
}
