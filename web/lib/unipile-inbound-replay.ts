/**
 * Server-side replay (Unipile → Tim queue). Not marked `server-only` so `tsx scripts/run-unipile-inbound-replay.ts` can import it; do not import from client components.
 */
import { handleUnipileWebhook } from "@/lib/linkedin-webhook";
import { normalizeUnipileDsn } from "@/lib/unipile-profile";
import { canUnipileReplayWriteToCrm } from "@/lib/unipile-replay-crm-guard";

const SELF_PROVIDER_ID =
  process.env.LINKEDIN_SELF_PROVIDER_ID?.trim() ||
  "ACoAAAFQFlkB-uguiq0-0980Ud_J2pdFMjzpQl8";

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function isFromSelf(m: Record<string, unknown>, selfId: string): boolean {
  if (m.is_sender === 1 || m.from_me === true || m.from_me === 1) return true;
  const sid = pickStr(m.sender_id) || pickStr(m.provider_id);
  if (sid && sid === selfId) return true;
  const sender = m.sender;
  if (sender && typeof sender === "object") {
    const ap = pickStr((sender as Record<string, unknown>).attendee_provider_id);
    if (ap && ap === selfId) return true;
  }
  return false;
}

/** Any sender / attendee provider id (ACoA… or vanity slug) — needed for Tim inbox + Postgres person match. */
function collectLinkedInSenderIds(m: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const push = (s: string | undefined) => {
    const t = s?.trim();
    if (t) ids.push(t);
  };
  push(pickStr(m.sender_id));
  push(pickStr(m.provider_id));
  const sender = m.sender;
  if (sender && typeof sender === "object") {
    const o = sender as Record<string, unknown>;
    push(pickStr(o.attendee_provider_id));
    push(pickStr(o.provider_id));
  }
  const attendees = m.attendees;
  if (Array.isArray(attendees)) {
    for (const a of attendees) {
      if (a && typeof a === "object") {
        push(pickStr((a as Record<string, unknown>).provider_id));
        push(pickStr((a as Record<string, unknown>).attendee_provider_id));
      }
    }
  }
  return [...new Set(ids)];
}

function counterpartyProviderId(m: Record<string, unknown>, selfId: string): string | null {
  const ids = collectLinkedInSenderIds(m).filter((id) => id !== selfId);
  if (!isFromSelf(m, selfId)) {
    return ids[0] ?? null;
  }
  if (ids.length === 1) return ids[0]!;
  return ids[0] ?? null;
}

function messageBody(m: Record<string, unknown>): string {
  return (
    pickStr(m.text) ||
    pickStr(m.message) ||
    pickStr(m.body) ||
    (typeof m.content === "string" ? m.content : "") ||
    ""
  );
}

function messageTimestampIso(m: Record<string, unknown>): string {
  const t = m.timestamp ?? m.created_at ?? m.date;
  if (typeof t === "number" && Number.isFinite(t)) {
    const ms = t < 1e12 ? t * 1000 : t;
    return new Date(ms).toISOString();
  }
  if (typeof t === "string" && t.trim()) return t.trim();
  return new Date().toISOString();
}

function messageIdForReplay(m: Record<string, unknown>, chatId: string, index: number): string {
  return (
    pickStr(m.id) ||
    pickStr(m.message_id) ||
    `replay:${chatId}:${messageTimestampIso(m)}:${index}`
  );
}

function senderFromMessage(m: Record<string, unknown>, cpId: string | null): {
  name: string;
  providerId: string;
} {
  const sender = m.sender;
  if (sender && typeof sender === "object") {
    const o = sender as Record<string, unknown>;
    const name =
      pickStr(o.attendee_name) ||
      pickStr(o.name) ||
      [pickStr(o.first_name), pickStr(o.last_name)].filter(Boolean).join(" ").trim() ||
      "Unknown";
    const providerId = pickStr(o.attendee_provider_id) || pickStr(o.provider_id) || cpId || "";
    return { name, providerId };
  }
  return { name: "Unknown", providerId: cpId || "" };
}

async function unipileGetJson(pathWithQuery: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const key = process.env.UNIPILE_API_KEY?.trim();
  const dsn = normalizeUnipileDsn(process.env.UNIPILE_DSN);
  const accountId = process.env.UNIPILE_ACCOUNT_ID?.trim();
  if (!key || !dsn || !accountId) {
    return { ok: false, status: 0, body: { error: "Unipile not configured" } };
  }
  const url = `https://${dsn}/api/v1${pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`}`;
  try {
    const res = await fetch(url, {
      headers: { "X-API-KEY": key, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    const raw = await res.text();
    let body: unknown = raw;
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      /* keep */
    }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, body: { error: msg } };
  }
}

export type UnipileInboundReplayItem = {
  chatId: string;
  messageId: string;
  preview: string;
  ok: boolean;
  error?: string;
};

export type UnipileInboundReplayResult = {
  ok: boolean;
  error?: string;
  chatsListed: number;
  inboundCandidates: number;
  replayed: number;
  skippedOutbound: number;
  items: UnipileInboundReplayItem[];
};

export type UnipileInboundWebhookCandidate = {
  chatId: string;
  sortKey: number;
  preview: string;
  webhookPayload: Parameters<typeof handleUnipileWebhook>[0];
};

/**
 * Lists recent LinkedIn chats, pulls messages per chat, returns **all** inbound (non-self) messages
 * sorted oldest → newest. Use {@link takeLastNInboundCandidates} then replay or export.
 */
export async function gatherUnipileInboundWebhookCandidates(input: {
  maxChats: number;
  messagesPerChat: number;
}): Promise<{
  ok: boolean;
  error?: string;
  chatsListed: number;
  skippedOutbound: number;
  candidates: UnipileInboundWebhookCandidate[];
}> {
  const accountId = process.env.UNIPILE_ACCOUNT_ID?.trim();
  if (!accountId || !process.env.UNIPILE_API_KEY?.trim() || !normalizeUnipileDsn(process.env.UNIPILE_DSN)) {
    return {
      ok: false,
      error: "Unipile not configured (UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_ACCOUNT_ID)",
      chatsListed: 0,
      skippedOutbound: 0,
      candidates: [],
    };
  }

  const maxChats = Math.min(50, Math.max(1, input.maxChats));
  const messagesPerChat = Math.min(50, Math.max(1, input.messagesPerChat));

  const listPath = `/chats?account_id=${encodeURIComponent(accountId)}&account_type=LINKEDIN&limit=${maxChats}`;
  const listRes = await unipileGetJson(listPath);
  if (!listRes.ok) {
    return {
      ok: false,
      error: `Unipile list chats failed: HTTP ${listRes.status} ${JSON.stringify(listRes.body).slice(0, 400)}`,
      chatsListed: 0,
      skippedOutbound: 0,
      candidates: [],
    };
  }

  const listBody = listRes.body as Record<string, unknown>;
  const rawItems = listBody.items || listBody.data;
  const chats = Array.isArray(rawItems) ? rawItems : [];

  const candidates: UnipileInboundWebhookCandidate[] = [];
  let skippedOutbound = 0;

  for (const c of chats) {
    const chat = c as Record<string, unknown>;
    const chatId = pickStr(chat.id) || pickStr(chat.chat_id);
    if (!chatId) continue;

    const msgRes = await unipileGetJson(
      `/chats/${encodeURIComponent(chatId)}/messages?limit=${messagesPerChat}`
    );
    if (!msgRes.ok) continue;
    const msgBody = msgRes.body as Record<string, unknown>;
    const rawMsgs = msgBody.items || msgBody.data;
    const messages = Array.isArray(rawMsgs) ? rawMsgs : [];

    let fallbackCp: string | null = null;
    for (const raw of messages) {
      const m = raw as Record<string, unknown>;
      if (!isFromSelf(m, SELF_PROVIDER_ID)) {
        fallbackCp = counterpartyProviderId(m, SELF_PROVIDER_ID);
        break;
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i] as Record<string, unknown>;
      if (isFromSelf(m, SELF_PROVIDER_ID)) {
        skippedOutbound += 1;
        continue;
      }
      const cp = counterpartyProviderId(m, SELF_PROVIDER_ID) ?? fallbackCp;
      const { name, providerId } = senderFromMessage(m, cp);
      const text = messageBody(m);
      const ts = messageTimestampIso(m);
      const mid = messageIdForReplay(m, chatId, i);
      const sortKey = new Date(ts).getTime() || 0;

      const webhookPayload: Parameters<typeof handleUnipileWebhook>[0] = {
        event: "message_received",
        account_id: accountId,
        account_type: "LINKEDIN",
        account_info: { user_id: SELF_PROVIDER_ID },
        chat_id: chatId,
        message_id: mid,
        message: text,
        sender: {
          attendee_name: name,
          attendee_provider_id: providerId,
        },
        timestamp: ts,
      };

      candidates.push({
        chatId,
        sortKey,
        webhookPayload,
        preview: `${name}: ${text.replace(/\s+/g, " ").trim().slice(0, 80)}${text.length > 80 ? "…" : ""}`,
      });
    }
  }

  candidates.sort((a, b) => a.sortKey - b.sortKey);

  return {
    ok: true,
    chatsListed: chats.length,
    skippedOutbound,
    candidates,
  };
}

/** Newest N inbound messages (after sort oldest → newest). */
export function takeLastNInboundCandidates(
  candidates: UnipileInboundWebhookCandidate[],
  n: number
): UnipileInboundWebhookCandidate[] {
  const max = Math.min(50, Math.max(1, n));
  return candidates.slice(-max);
}

/**
 * Fetches recent LinkedIn chats/messages from Unipile (same endpoints as CRM corpus sync),
 * takes the last `maxInbound` **inbound** messages (newest first after sort), and runs each
 * through {@link handleUnipileWebhook} — same path as production Unipile webhooks (CRM notes,
 * warm-outreach resolve, general inbox queue).
 *
 * Re-running the same messages creates duplicate notes/artifacts; use dryRun to inspect first.
 */
export async function replayRecentUnipileInboundAsWebhooks(input: {
  maxChats: number;
  messagesPerChat: number;
  maxInbound: number;
  dryRun: boolean;
}): Promise<UnipileInboundReplayResult> {
  const accountId = process.env.UNIPILE_ACCOUNT_ID?.trim();
  if (!accountId || !process.env.UNIPILE_API_KEY?.trim() || !normalizeUnipileDsn(process.env.UNIPILE_DSN)) {
    return {
      ok: false,
      error: "Unipile not configured (UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_ACCOUNT_ID)",
      chatsListed: 0,
      inboundCandidates: 0,
      replayed: 0,
      skippedOutbound: 0,
      items: [],
    };
  }

  if (!input.dryRun) {
    const crmOk = canUnipileReplayWriteToCrm();
    if (!crmOk.ok) {
      return {
        ok: false,
        error: crmOk.message,
        chatsListed: 0,
        inboundCandidates: 0,
        replayed: 0,
        skippedOutbound: 0,
        items: [],
      };
    }
  }

  const maxInbound = Math.min(50, Math.max(1, input.maxInbound));

  const gathered = await gatherUnipileInboundWebhookCandidates({
    maxChats: input.maxChats,
    messagesPerChat: input.messagesPerChat,
  });
  if (!gathered.ok) {
    return {
      ok: false,
      error: gathered.error,
      chatsListed: 0,
      inboundCandidates: 0,
      replayed: 0,
      skippedOutbound: 0,
      items: [],
    };
  }

  const { candidates, chatsListed, skippedOutbound } = gathered;
  const slice = takeLastNInboundCandidates(candidates, maxInbound);

  const items: UnipileInboundReplayItem[] = [];

  for (const c of slice) {
    if (input.dryRun) {
      items.push({
        chatId: c.chatId,
        messageId: String(c.webhookPayload.message_id),
        preview: c.preview,
        ok: true,
      });
      continue;
    }
    try {
      await handleUnipileWebhook(c.webhookPayload);
      items.push({
        chatId: c.chatId,
        messageId: String(c.webhookPayload.message_id),
        preview: c.preview,
        ok: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      items.push({
        chatId: c.chatId,
        messageId: String(c.webhookPayload.message_id),
        preview: c.preview,
        ok: false,
        error: msg,
      });
    }
  }

  return {
    ok: true,
    chatsListed,
    inboundCandidates: candidates.length,
    replayed: items.filter((i) => i.ok).length,
    skippedOutbound,
    items,
  };
}
