import "server-only";

import { query } from "@/lib/db";
import { pushUnipileObservabilityLog } from "@/lib/unipile-observability-buffer";
import {
  injectInboundIntoReplyDraftMarkdown,
  type WarmThreadTurn,
} from "@/lib/warm-outreach-draft";

const SELF_PROVIDER_ID =
  process.env.LINKEDIN_SELF_PROVIDER_ID?.trim() ||
  "ACoAAAFQFlkB-uguiq0-0980Ud_J2pdFMjzpQl8";

function normalizeDsn(raw: string | undefined): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/^https?:\/\//i, "");
  return s.split("/")[0]?.trim() ?? "";
}

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

function collectSenderIds(m: Record<string, unknown>): string[] {
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
  return [...new Set(ids)];
}

function counterpartyFromMessage(m: Record<string, unknown>, selfId: string): string | null {
  const ids = collectSenderIds(m).filter((id) => id !== selfId);
  if (!isFromSelf(m, selfId)) return ids[0] ?? null;
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

function messageTsMs(m: Record<string, unknown>): number {
  const t = m.timestamp ?? m.created_at ?? m.date;
  if (typeof t === "number" && Number.isFinite(t)) {
    const ms = t < 1e12 ? t * 1000 : t;
    return ms;
  }
  if (typeof t === "string" && t.trim()) {
    const d = new Date(t.trim()).getTime();
    return Number.isFinite(d) ? d : 0;
  }
  return 0;
}

async function unipileGet(pathWithQuery: string): Promise<{
  ok: boolean;
  status: number;
  body: Record<string, unknown> & { raw?: string };
}> {
  const key = process.env.UNIPILE_API_KEY?.trim();
  const dsn = normalizeDsn(process.env.UNIPILE_DSN);
  const accountId = process.env.UNIPILE_ACCOUNT_ID?.trim();
  if (!key || !dsn || !accountId) {
    throw new Error("Unipile not configured (UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_ACCOUNT_ID)");
  }
  const url = `https://${dsn}/api/v1${pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`}`;
  const res = await fetch(url, {
    headers: { "X-API-KEY": key, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
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

const UNIPILE_THREAD_SNAPSHOT_LIMIT = 250;
const MAX_CHARS_PER_THREAD_MESSAGE = 12_000;

export function buildRepliedArtifactMarkdown(inbound: string, threadTurns?: WarmThreadTurn[]): string {
  const safe = String(inbound || "").trim();
  const base = `# Contact replied\n\n**Their LinkedIn message** (captured when this thread opened):\n\n${safe}\n\n---\n\nYou're in **conversation mode** — Tim drafts replies until you **End Sequence**. Open **Reply draft** for the next send.\n\n---\n*Transition artifact*`;
  if (!threadTurns?.length) return base;
  const clipped = threadTurns.map((t) => ({
    role: t.role,
    text:
      t.text.length > MAX_CHARS_PER_THREAD_MESSAGE
        ? `${t.text.slice(0, MAX_CHARS_PER_THREAD_MESSAGE)}\n… [truncated]`
        : t.text,
    createdAt: t.createdAt,
  }));
  const json = JSON.stringify(clipped);
  return `${base}\n\n## Thread sync (Unipile)\n\nFull conversation from LinkedIn as of this **Update LinkedIn** run (oldest first in the JSON; the UI may show newest at top).\n\n\`\`\`unipile-thread-json\n${json}\n\`\`\`\n`;
}

export type FindNewestInboundFromUnipileResult = {
  newestInbound: string;
  /** Chat used to load the full thread snapshot (may be null if unknown). */
  sourceChatId: string | null;
};

async function fetchChatThreadTurnsFromUnipile(
  chatId: string,
  limit: number
): Promise<WarmThreadTurn[]> {
  const msgRes = await unipileGet(`/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`);
  if (!msgRes.ok) {
    pushUnipileObservabilityLog(
      `[unipile-lab] ${JSON.stringify(
        {
          kind: "warm_backfill_full_thread_fetch",
          ok: false,
          chatId,
          status: msgRes.status,
        },
        null,
        2
      )}`
    );
    return [];
  }
  const rawMsgs = msgRes.body.items ?? msgRes.body.data;
  const messages = Array.isArray(rawMsgs) ? rawMsgs : [];
  const rows: WarmThreadTurn[] = [];
  for (const raw of messages) {
    const m = raw as Record<string, unknown>;
    const text = messageBody(m).trim();
    if (!text) continue;
    const ts = messageTsMs(m);
    const role: "you" | "them" = isFromSelf(m, SELF_PROVIDER_ID) ? "you" : "them";
    const createdAt = new Date(ts > 0 ? ts : Date.now()).toISOString();
    rows.push({ role, text, createdAt });
  }
  rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  pushUnipileObservabilityLog(
    `[unipile-lab] ${JSON.stringify(
      {
        kind: "warm_backfill_full_thread_fetch",
        ok: true,
        chatId,
        messageCount: rows.length,
        limit,
      },
      null,
      2
    )}`
  );
  return rows;
}

export async function findNewestInboundFromUnipile(
  firstName: string,
  targetProviderId: string | null
): Promise<FindNewestInboundFromUnipileResult> {
  const accountId = process.env.UNIPILE_ACCOUNT_ID?.trim();
  if (!accountId) throw new Error("UNIPILE_ACCOUNT_ID is not set");
  const maxChats = 100;
  const msgLimit = 80;
  pushUnipileObservabilityLog(
    `[unipile-lab] ${JSON.stringify(
      {
        kind: "warm_backfill_scan_start",
        firstName,
        hasTargetProviderId: Boolean(targetProviderId),
        maxChats,
      },
      null,
      2
    )}`
  );
  const listRes = await unipileGet(
    `/chats?account_id=${encodeURIComponent(accountId)}&account_type=LINKEDIN&limit=${maxChats}`
  );
  if (!listRes.ok) {
    pushUnipileObservabilityLog(
      `[unipile-lab] ${JSON.stringify(
        {
          kind: "warm_backfill_list_chats",
          ok: false,
          status: listRes.status,
          detail: JSON.stringify(listRes.body).slice(0, 600),
        },
        null,
        2
      )}`
    );
    throw new Error(
      `Unipile list chats failed: HTTP ${listRes.status} ${JSON.stringify(listRes.body).slice(0, 400)}`
    );
  }
  const rawItems = listRes.body.items ?? listRes.body.data;
  const chats = Array.isArray(rawItems) ? rawItems : [];
  pushUnipileObservabilityLog(
    `[unipile-lab] ${JSON.stringify(
      { kind: "warm_backfill_list_chats", ok: true, status: listRes.status, chatCount: chats.length },
      null,
      2
    )}`
  );

  const nameRe = new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

  let bestByProvider = { text: "", ts: -1, chatId: null as string | null };
  const candidatesFromName: { text: string; ts: number; chatId: string }[] = [];

  for (const c of chats) {
    const chat = c as Record<string, unknown>;
    const chatId = pickStr(chat.id) || pickStr(chat.chat_id);
    if (!chatId) continue;

    const msgRes = await unipileGet(`/chats/${encodeURIComponent(chatId)}/messages?limit=${msgLimit}`);
    if (!msgRes.ok) continue;
    const rawMsgs = msgRes.body.items ?? msgRes.body.data;
    const messages = Array.isArray(rawMsgs) ? rawMsgs : [];

    let nameMatchedChat = false;
    for (const raw of messages) {
      const m = raw as Record<string, unknown>;
      const body = messageBody(m);
      if (isFromSelf(m, SELF_PROVIDER_ID) && nameRe.test(body)) {
        nameMatchedChat = true;
        break;
      }
    }

    for (const raw of messages) {
      const m = raw as Record<string, unknown>;
      if (isFromSelf(m, SELF_PROVIDER_ID)) continue;
      const cp = counterpartyFromMessage(m, SELF_PROVIDER_ID);
      const ts = messageTsMs(m);
      const text = messageBody(m).trim();
      if (!text) continue;

      if (targetProviderId && cp && cp === targetProviderId && ts >= bestByProvider.ts) {
        bestByProvider = { text, ts, chatId };
      }
      if (nameMatchedChat && ts >= 0) {
        candidatesFromName.push({ text, ts, chatId });
      }
    }
  }

  if (targetProviderId && bestByProvider.ts >= 0) {
    pushUnipileObservabilityLog(
      `[unipile-lab] ${JSON.stringify(
        {
          kind: "warm_backfill_found_inbound",
          match: "provider_id",
          textLen: bestByProvider.text.length,
          chatId: bestByProvider.chatId,
        },
        null,
        2
      )}`
    );
    return {
      newestInbound: bestByProvider.text,
      sourceChatId: bestByProvider.chatId,
    };
  }

  if (candidatesFromName.length === 0) {
    pushUnipileObservabilityLog(
      `[unipile-lab] ${JSON.stringify(
        { kind: "warm_backfill_no_inbound", firstName, chatThreadsScanned: chats.length },
        null,
        2
      )}`
    );
    throw new Error(
      `No inbound LinkedIn message found for "${firstName}". Set linkedinProviderId on the person row, or ensure a recent outbound mentions their first name.`
    );
  }

  candidatesFromName.sort((a, b) => b.ts - a.ts);
  const top = candidatesFromName[0];
  const picked = top.text;
  pushUnipileObservabilityLog(
    `[unipile-lab] ${JSON.stringify(
      {
        kind: "warm_backfill_found_inbound",
        match: "name_in_thread",
        textLen: picked.length,
        chatId: top.chatId,
      },
      null,
      2
    )}`
  );
  return { newestInbound: picked, sourceChatId: top.chatId };
}

type PersonRow = {
  workflowItemId: string;
  workflowId: string | null;
  personId: string;
  firstName: string;
  lastName: string;
};

async function loadWarmOutreachPersonByWorkflowItemId(itemId: string): Promise<PersonRow | null> {
  const q = `
    SELECT
      wi.id AS "workflowItemId",
      wi."workflowId" AS "workflowId",
      p.id AS "personId",
      TRIM(COALESCE(p."nameFirstName", '')) AS "firstName",
      TRIM(COALESCE(p."nameLastName", '')) AS "lastName"
    FROM "_workflow_item" wi
    INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
    INNER JOIN person p ON p.id = wi."sourceId" AND wi."sourceType" = 'person' AND p."deletedAt" IS NULL
    WHERE wi."deletedAt" IS NULL
      AND wi.id = $1
      AND (
        COALESCE(w.spec::text, '') LIKE '%warm-outreach%'
        OR COALESCE(w.spec::text, '') LIKE '%linkedin-outreach%'
      )
    LIMIT 1
  `;
  const rows = await query<PersonRow>(q, [itemId]);
  return rows[0] ?? null;
}

async function loadWarmOutreachPersonByFirstName(firstName: string): Promise<PersonRow | null> {
  const q = `
    SELECT
      wi.id AS "workflowItemId",
      wi."workflowId" AS "workflowId",
      p.id AS "personId",
      TRIM(COALESCE(p."nameFirstName", '')) AS "firstName",
      TRIM(COALESCE(p."nameLastName", '')) AS "lastName"
    FROM "_workflow_item" wi
    INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
    INNER JOIN person p ON p.id = wi."sourceId" AND wi."sourceType" = 'person' AND p."deletedAt" IS NULL
    WHERE wi."deletedAt" IS NULL
      AND (
        COALESCE(w.spec::text, '') LIKE '%warm-outreach%'
        OR COALESCE(w.spec::text, '') LIKE '%linkedin-outreach%'
      )
      AND LOWER(TRIM(COALESCE(p."nameFirstName", ''))) = LOWER($1)
    ORDER BY wi."updatedAt" DESC
    LIMIT 1
  `;
  const rows = await query<PersonRow>(q, [firstName]);
  return rows[0] ?? null;
}

async function fetchLinkedinProviderId(personId: string): Promise<string | null> {
  try {
    const prId = await query<{ id: string | null }>(
      `SELECT NULLIF(TRIM(COALESCE(p."linkedinProviderId", '')), '') AS id
       FROM person p WHERE p.id = $1 AND p."deletedAt" IS NULL`,
      [personId]
    );
    return prId[0]?.id ?? null;
  } catch {
    return null;
  }
}

export type WarmRepliedInboundBackfillResult =
  | {
      ok: true;
      inboundPreview: string;
      firstName: string;
      lastName: string;
      draftUpdated: boolean;
    }
  | { ok: false; error: string };

async function runBackfillForPersonRow(
  personRow: PersonRow,
  options: { dryRun?: boolean }
): Promise<WarmRepliedInboundBackfillResult> {
  const { dryRun } = options;
  const itemId = personRow.workflowItemId;
  const firstName = personRow.firstName;
  if (!firstName?.trim()) {
    return { ok: false, error: "Person has no first name; cannot match Unipile thread." };
  }

  pushUnipileObservabilityLog(
    `[unipile-lab] ${JSON.stringify(
      { kind: "warm_backfill_item_start", workflowItemId: itemId, firstName: firstName.trim(), dryRun: Boolean(dryRun) },
      null,
      2
    )}`
  );

  const providerId = await fetchLinkedinProviderId(personRow.personId);
  let inbound: string;
  let sourceChatId: string | null = null;
  try {
    const resolution = await findNewestInboundFromUnipile(firstName.trim(), providerId);
    inbound = resolution.newestInbound;
    sourceChatId = resolution.sourceChatId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushUnipileObservabilityLog(
      `[unipile-lab] ${JSON.stringify(
        { kind: "warm_backfill_item_error", workflowItemId: itemId, error: msg.slice(0, 800) },
        null,
        2
      )}`
    );
    return { ok: false, error: msg };
  }

  let threadTurns: WarmThreadTurn[] | undefined;
  if (sourceChatId && !dryRun) {
    threadTurns = await fetchChatThreadTurnsFromUnipile(
      sourceChatId,
      UNIPILE_THREAD_SNAPSHOT_LIMIT
    );
  }

  const repliedMd = buildRepliedArtifactMarkdown(inbound, threadTurns);
  const preview = inbound.length > 140 ? `${inbound.slice(0, 140).trim()}…` : inbound.trim();

  if (dryRun) {
    pushUnipileObservabilityLog(
      `[unipile-lab] ${JSON.stringify(
        {
          kind: "warm_backfill_item_done",
          workflowItemId: itemId,
          dryRun: true,
          inboundPreviewLen: preview.length,
        },
        null,
        2
      )}`
    );
    return {
      ok: true,
      inboundPreview: preview,
      firstName: personRow.firstName,
      lastName: personRow.lastName,
      draftUpdated: false,
    };
  }

  const ar = await query<{ id: string; content: string }>(
    `SELECT id, content FROM "_artifact"
     WHERE "workflowItemId" = $1 AND stage = 'REPLIED' AND "deletedAt" IS NULL
     ORDER BY "createdAt" DESC LIMIT 1`,
    [itemId]
  );

  if (ar.length === 0) {
    await query(
      `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
       VALUES ($1, $2, 'REPLIED', 'Contact replied', 'markdown', $3, NOW(), NOW())`,
      [itemId, personRow.workflowId || null, repliedMd]
    );
  } else {
    await query(`UPDATE "_artifact" SET content = $1, "updatedAt" = NOW() WHERE id = $2`, [
      repliedMd,
      ar[0].id,
    ]);
  }

  const dr = await query<{ id: string; content: string }>(
    `SELECT id, content FROM "_artifact"
     WHERE "workflowItemId" = $1 AND stage = 'REPLY_DRAFT' AND "deletedAt" IS NULL
     ORDER BY "createdAt" DESC LIMIT 1`,
    [itemId]
  );

  let draftUpdated = false;
  if (dr.length > 0) {
    const newDraft = injectInboundIntoReplyDraftMarkdown(dr[0].content, inbound);
    if (newDraft !== dr[0].content) {
      await query(`UPDATE "_artifact" SET content = $1, "updatedAt" = NOW() WHERE id = $2`, [
        newDraft,
        dr[0].id,
      ]);
      draftUpdated = true;
    }
  }
  pushUnipileObservabilityLog(
    `[unipile-lab] ${JSON.stringify(
      {
        kind: "warm_backfill_item_done",
        workflowItemId: itemId,
        draftUpdated,
        inboundPreviewLen: preview.length,
      },
      null,
      2
    )}`
  );

  return {
    ok: true,
    inboundPreview: preview,
    firstName: personRow.firstName,
    lastName: personRow.lastName,
    draftUpdated,
  };
}

export async function backfillWarmRepliedInboundFromWorkflowItemId(
  workflowItemId: string,
  options?: { dryRun?: boolean }
): Promise<WarmRepliedInboundBackfillResult> {
  const personRow = await loadWarmOutreachPersonByWorkflowItemId(workflowItemId);
  if (!personRow) {
    return {
      ok: false,
      error:
        "No matching workflow item (needs warm-outreach or linkedin-outreach, person-linked, not deleted).",
    };
  }
  return runBackfillForPersonRow(personRow, options ?? {});
}

export async function backfillWarmRepliedInboundFromFirstName(
  firstName: string,
  options?: { dryRun?: boolean }
): Promise<WarmRepliedInboundBackfillResult> {
  const personRow = await loadWarmOutreachPersonByFirstName(firstName.trim());
  if (!personRow) {
    return {
      ok: false,
      error: `No warm- or linkedin-outreach workflow item found for first name "${firstName}" (case-insensitive).`,
    };
  }
  return runBackfillForPersonRow(personRow, options ?? {});
}
