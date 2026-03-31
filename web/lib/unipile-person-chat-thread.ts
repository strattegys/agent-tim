/**
 * Find the 1:1 LinkedIn DM chat for a CRM contact (Unipile provider id) and return messages
 * oldest → newest — includes outbound connection-request notes that never hit Postgres artifacts.
 */
import "server-only";

import { normalizeUnipileDsn } from "@/lib/unipile-profile";
import { pushUnipileObservabilityLog } from "@/lib/unipile-observability-buffer";

const SELF_PROVIDER_ID =
  process.env.LINKEDIN_SELF_PROVIDER_ID?.trim() ||
  "ACoAAAFQFlkB-uguiq0-0980Ud_J2pdFMjzpQl8";

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function normPid(s: string): string {
  return s.trim().toUpperCase();
}

function isFromSelf(m: Record<string, unknown>, selfId: string): boolean {
  if (m.is_sender === 1 || m.from_me === true || m.from_me === 1) return true;
  const sid = pickStr(m.sender_id) || pickStr(m.provider_id);
  if (sid && normPid(sid) === normPid(selfId)) return true;
  const sender = m.sender;
  if (sender && typeof sender === "object") {
    const o = sender as Record<string, unknown>;
    const ap = pickStr(o.attendee_provider_id) || pickStr(o.provider_id);
    if (ap && normPid(ap) === normPid(selfId)) return true;
  }
  return false;
}

function collectLinkedInSenderIds(m: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const push = (s: unknown) => {
    const t = typeof s === "string" ? s.trim() : "";
    if (t) ids.push(t);
  };
  push(m.sender_id);
  push(m.provider_id);
  const sender = m.sender;
  if (sender && typeof sender === "object") {
    const o = sender as Record<string, unknown>;
    push(o.attendee_provider_id);
    push(o.provider_id);
  }
  const attendees = m.attendees;
  if (Array.isArray(attendees)) {
    for (const a of attendees) {
      if (a && typeof a === "object") {
        push((a as Record<string, unknown>).provider_id);
        push((a as Record<string, unknown>).attendee_provider_id);
      }
    }
  }
  return [...new Set(ids)];
}

function messageBody(m: Record<string, unknown>): string {
  const fromFlat =
    pickStr(m.text) ||
    pickStr(m.message) ||
    pickStr(m.body) ||
    pickStr(m.subject) ||
    pickStr(m.snippet) ||
    (typeof m.content === "string" ? m.content : "") ||
    "";
  if (fromFlat.trim()) return fromFlat;
  const c = m.content;
  if (c && typeof c === "object") {
    const o = c as Record<string, unknown>;
    return (
      pickStr(o.text) ||
      pickStr(o.body) ||
      pickStr(o.message) ||
      pickStr(o.rendered_content) ||
      ""
    );
  }
  return "";
}

function messageTsIso(m: Record<string, unknown>): string {
  const t = m.timestamp ?? m.created_at ?? m.date;
  if (typeof t === "number" && Number.isFinite(t)) {
    const ms = t < 1e12 ? t * 1000 : t;
    return new Date(ms).toISOString();
  }
  if (typeof t === "string" && t.trim()) return t.trim();
  return new Date().toISOString();
}

function collectChatProviderIds(chat: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    const t = typeof v === "string" ? v.trim() : "";
    if (t) out.push(normPid(t));
  };
  add(chat.provider_id);
  add(chat.attendee_provider_id);
  add(chat.user_provider_id);
  const attendees = chat.attendees;
  if (Array.isArray(attendees)) {
    for (const a of attendees) {
      if (a && typeof a === "object") {
        const o = a as Record<string, unknown>;
        add(o.provider_id);
        add(o.attendee_provider_id);
        add(o.id);
      }
    }
  }
  return [...new Set(out)];
}

/**
 * @param fromAttendeeChatsEndpoint When true, chat came from `GET /chat_attendees/{target}/chats` — Unipile already
 *   scoped it; do not require sender metadata to mention both parties (outbound-only connection notes fail that check).
 */
function chatMatchesPerson(
  chat: Record<string, unknown>,
  messages: Record<string, unknown>[],
  targetProviderId: string,
  selfId: string,
  fromAttendeeChatsEndpoint = false
): boolean {
  if (fromAttendeeChatsEndpoint) {
    return true;
  }

  const target = normPid(targetProviderId);
  const self = normPid(selfId);
  const meta = collectChatProviderIds(chat);

  if (meta.includes(target)) {
    if (meta.includes(self)) return true;
    if (messages.some((m) => isFromSelf(m, selfId))) return true;
    // Outbound-only thread (e.g. connection request note) — target often absent from per-message sender ids
    if (messages.length > 0 && messages.every((m) => isFromSelf(m, selfId))) return true;
    if (messages.length === 0) return true;
  }

  let sawSelf = false;
  let sawTarget = false;
  for (const raw of messages) {
    const ids = collectLinkedInSenderIds(raw).map(normPid);
    if (ids.includes(self)) sawSelf = true;
    if (ids.includes(target)) sawTarget = true;
  }
  return sawSelf && sawTarget;
}

async function unipileGet(pathWithQuery: string): Promise<{
  ok: boolean;
  status: number;
  body: Record<string, unknown> & { raw?: string };
}> {
  const key = process.env.UNIPILE_API_KEY?.trim();
  const dsn = normalizeUnipileDsn(process.env.UNIPILE_DSN);
  const accountId = process.env.UNIPILE_ACCOUNT_ID?.trim();
  if (!key || !dsn || !accountId) {
    throw new Error("Unipile not configured (UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_ACCOUNT_ID)");
  }
  const url = `https://${dsn}/api/v1${pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`}`;
  const res = await fetch(url, {
    headers: { "X-API-KEY": key, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await res.text();
  let body: Record<string, unknown> & { raw?: string };
  try {
    body = JSON.parse(raw) as Record<string, unknown> & { raw?: string };
  } catch {
    body = { raw };
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * Unipile: list 1:1 chats where this attendee participates. `attendee_id` may be LinkedIn `provider_id` (ACoA…).
 * @see https://developer.unipile.com/reference/chatattendeescontroller_listchatsbyattendee
 */
async function listChatsForAttendee(
  accountId: string,
  attendeeProviderId: string
): Promise<{ ok: boolean; status: number; chats: Record<string, unknown>[] }> {
  const enc = encodeURIComponent(attendeeProviderId.trim());
  const res = await unipileGet(
    `/chat_attendees/${enc}/chats?account_id=${encodeURIComponent(accountId)}&limit=50`
  );
  if (!res.ok) {
    return { ok: false, status: res.status, chats: [] };
  }
  const raw = res.body.items ?? res.body.data;
  const arr = Array.isArray(raw) ? raw : [];
  return { ok: true, status: res.status, chats: arr as Record<string, unknown>[] };
}

async function listLinkedInChatsPaged(accountId: string, maxTotalChats: number): Promise<Record<string, unknown>[]> {
  const cap = Math.min(600, Math.max(1, maxTotalChats));
  const chats: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let guard = 0;

  while (chats.length < cap && guard < 50) {
    guard++;
    const pageLimit = Math.min(250, cap - chats.length);
    let path = `/chats?account_id=${encodeURIComponent(accountId)}&account_type=LINKEDIN&limit=${pageLimit}`;
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;

    const listRes = await unipileGet(path);
    if (!listRes.ok) break;

    const listBody = listRes.body;
    const rawItems = listBody.items || listBody.data;
    const page = Array.isArray(rawItems) ? rawItems : [];
    for (const c of page) chats.push(c as Record<string, unknown>);

    const next = listBody.cursor;
    const nextCursor = typeof next === "string" && next.length > 0 ? next : null;
    if (!nextCursor || page.length === 0) break;
    cursor = nextCursor;
  }

  return chats;
}

export type UnipileThreadLine = {
  at: string;
  direction: "outbound" | "inbound";
  body: string;
};

export type FetchLinkedInThreadForPersonResult =
  | {
      ok: true;
      chatId: string | null;
      messages: UnipileThreadLine[];
      /** How Unipile was queried: direct attendee lookup vs scanning all recent chats (fallback). */
      resolution: "attendee_chats" | "full_scan";
      scannedChats: number;
    }
  | { ok: false; error: string; scannedChats?: number };

function messagesToLines(
  messages: Record<string, unknown>[],
  selfId: string
): UnipileThreadLine[] {
  const lines: UnipileThreadLine[] = [];
  for (const m of messages) {
    let body = messageBody(m).trim();
    if (!body) {
      body = "Unipile returned no text for this message (attachment or system event).";
    }
    lines.push({
      at: messageTsIso(m),
      direction: isFromSelf(m, selfId) ? "outbound" : "inbound",
      body,
    });
  }
  lines.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return lines;
}

/**
 * Loads DM thread for one LinkedIn member id: prefers Unipile `GET /chat_attendees/{provider_id}/chats`, then
 * falls back to scanning recent account chats if that endpoint is empty or unavailable.
 */
export async function fetchLinkedInThreadForProviderMemberId(
  targetProviderId: string,
  opts?: { maxChats?: number; messagesLimit?: number }
): Promise<FetchLinkedInThreadForPersonResult> {
  const target = targetProviderId.trim();
  if (!target) {
    return { ok: false, error: "Missing LinkedIn provider id" };
  }

  const accountId = process.env.UNIPILE_ACCOUNT_ID?.trim();
  if (!accountId || !process.env.UNIPILE_API_KEY?.trim() || !normalizeUnipileDsn(process.env.UNIPILE_DSN)) {
    return {
      ok: false,
      error: "Unipile not configured on the server (UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_ACCOUNT_ID)",
    };
  }

  const maxChats = Math.min(500, Math.max(1, opts?.maxChats ?? 200));
  const messagesLimit = Math.min(100, Math.max(10, opts?.messagesLimit ?? 80));
  const selfId = SELF_PROVIDER_ID;

  try {
    const attendeeList = await listChatsForAttendee(accountId, target);
    if (attendeeList.ok && attendeeList.chats.length > 0) {
      pushUnipileObservabilityLog(
        `[unipile-lab] ${JSON.stringify(
          {
            kind: "person_chat_thread_attendee_api",
            targetPrefix: target.slice(0, 12),
            chatCandidates: attendeeList.chats.length,
          },
          null,
          2
        )}`
      );

      for (let i = 0; i < attendeeList.chats.length; i++) {
        const c = attendeeList.chats[i];
        const chatId = pickStr(c.id) || pickStr(c.chat_id);
        if (!chatId) continue;

        const msgRes = await unipileGet(
          `/chats/${encodeURIComponent(chatId)}/messages?limit=${messagesLimit}`
        );
        if (!msgRes.ok) {
          pushUnipileObservabilityLog(
            `[unipile-lab] ${JSON.stringify(
              {
                kind: "person_chat_thread_messages_fetch_fail",
                via: "attendee_chats",
                chatId,
                httpStatus: msgRes.status,
                candidateIndex: i + 1,
              },
              null,
              2
            )}`
          );
          continue;
        }

        const rawMsgs =
          msgRes.body.items ?? msgRes.body.data ?? msgRes.body.messages ?? msgRes.body.results;
        const rawList = Array.isArray(rawMsgs) ? rawMsgs : [];
        const messages = rawList as Record<string, unknown>[];

        if (!chatMatchesPerson(c, messages, target, selfId, true)) continue;

        const lines = messagesToLines(messages, selfId);
        pushUnipileObservabilityLog(
          `[unipile-lab] ${JSON.stringify(
            {
              kind: "person_chat_thread_hit",
              via: "attendee_chats",
              chatId,
              messageCount: lines.length,
              rawMessageCount: messages.length,
              candidateIndex: i + 1,
            },
            null,
            2
          )}`
        );
        return {
          ok: true,
          chatId,
          messages: lines,
          resolution: "attendee_chats",
          scannedChats: attendeeList.chats.length,
        };
      }
    } else if (!attendeeList.ok) {
      pushUnipileObservabilityLog(
        `[unipile-lab] ${JSON.stringify(
          {
            kind: "person_chat_thread_attendee_api_fallback",
            httpStatus: attendeeList.status,
            targetPrefix: target.slice(0, 12),
          },
          null,
          2
        )}`
      );
    }

    const chats = await listLinkedInChatsPaged(accountId, maxChats);
    pushUnipileObservabilityLog(
      `[unipile-lab] ${JSON.stringify(
        {
          kind: "person_chat_thread_full_scan",
          targetPrefix: target.slice(0, 12),
          chatCount: chats.length,
          messagesLimit,
        },
        null,
        2
      )}`
    );

    for (let i = 0; i < chats.length; i++) {
      const c = chats[i];
      const chatId = pickStr(c.id) || pickStr(c.chat_id);
      if (!chatId) continue;

      const metaIds = collectChatProviderIds(c);
      if (metaIds.length > 0 && !metaIds.includes(normPid(target))) continue;

      const msgRes = await unipileGet(
        `/chats/${encodeURIComponent(chatId)}/messages?limit=${messagesLimit}`
      );
      if (!msgRes.ok) continue;

      const rawMsgs =
        msgRes.body.items ?? msgRes.body.data ?? msgRes.body.messages ?? msgRes.body.results;
      const rawList = Array.isArray(rawMsgs) ? rawMsgs : [];
      const messages = rawList as Record<string, unknown>[];

      if (!chatMatchesPerson(c, messages, target, selfId, false)) continue;

      const lines = messagesToLines(messages, selfId);

      pushUnipileObservabilityLog(
        `[unipile-lab] ${JSON.stringify(
          {
            kind: "person_chat_thread_hit",
            via: "full_scan",
            chatId,
            messageCount: lines.length,
            rawMessageCount: messages.length,
            scannedBeforeHit: i + 1,
          },
          null,
          2
        )}`
      );

      return {
        ok: true,
        chatId,
        messages: lines,
        resolution: "full_scan",
        scannedChats: chats.length,
      };
    }

    return {
      ok: true,
      chatId: null,
      messages: [],
      resolution: attendeeList.ok && attendeeList.chats.length === 0 ? "attendee_chats" : "full_scan",
      scannedChats: attendeeList.ok ? attendeeList.chats.length : chats.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 500) };
  }
}
