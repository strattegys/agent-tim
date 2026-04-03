import "server-only";

import { query } from "./db";
import {
  sqlPersonLinkedinUrlCoalesce,
  isLinkedInProviderMemberId,
  postgresMissingColumn,
} from "./linkedin-person-identity";
import {
  normalizeUnipileDsn,
  extractLinkedInProfileIdentifier,
  extractUnipilePublicIdentifierFromProfile,
  fetchUnipileLinkedInProfile,
} from "./unipile-profile";
import {
  ensureTimCrmMirrorKbTopic,
  insertAgentKnowledgeChunk,
  knowledgeChunkExistsByExternalRef,
  touchKbTopicLastSync,
} from "./marni-kb";

const SELF_PROVIDER_DEFAULT =
  process.env.LINKEDIN_SELF_PROVIDER_ID?.trim() ||
  "ACoAAAFQFlkB-uguiq0-0980Ud_J2pdFMjzpQl8";

/** Set `TIM_KB_SYNC_PROGRESS_LOG=1` in production; in `development` logs by default. */
const TIM_KB_SYNC_PROGRESS_LOG =
  process.env.TIM_KB_SYNC_PROGRESS_LOG === "1" ||
  process.env.NODE_ENV === "development";

function logTimKbSync(...parts: unknown[]) {
  if (!TIM_KB_SYNC_PROGRESS_LOG) return;
  console.log("[tim-kb-sync]", ...parts);
}

export interface TimCrmSyncOptions {
  chatLimit: number;
  messagesPerChat: number;
  includeNotes: boolean;
  dryRun: boolean;
  /** Hard cap on new embeddings per run (cost guard). */
  maxNewChunks?: number;
  /** Unipile GET /users/{ACoA…} calls to map member id → public slug when CRM only has URL slug (rate/cost guard). */
  maxProfileLookups?: number;
}

export interface TimCrmSyncResult {
  ok: boolean;
  topicId: string;
  chatsProcessed: number;
  messagesSeen: number;
  messagesInserted: number;
  messagesSkippedDuplicate: number;
  messagesSkippedNoPerson: number;
  unmatchedChats: number;
  notesSeen: number;
  notesInserted: number;
  notesSkippedDuplicate: number;
  stoppedByCap: boolean;
  errors: string[];
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

function collectProviderIds(m: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const push = (s: string | undefined) => {
    if (s && /^ACoA[A-Za-z0-9_-]+$/i.test(s)) ids.push(s);
  };
  push(pickStr(m.sender_id));
  push(pickStr(m.provider_id));
  push(pickStr(m.sender_attendee_id));
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

function counterpartyProviderId(
  m: Record<string, unknown>,
  selfId: string,
  fallback: string | null
): string | null {
  const ids = collectProviderIds(m).filter((id) => id !== selfId);
  if (!isFromSelf(m, selfId)) {
    return ids[0] ?? null;
  }
  if (fallback && fallback !== selfId) return fallback;
  if (ids.length === 1) return ids[0]!;
  return null;
}

function messageText(m: Record<string, unknown>): string {
  return (
    pickStr(m.text) ||
    pickStr(m.message) ||
    pickStr(m.body) ||
    (typeof m.content === "string" ? m.content : "") ||
    ""
  ).trim();
}

function messageId(m: Record<string, unknown>, chatId: string, index: number): string {
  return (
    pickStr(m.id) ||
    pickStr(m.message_id) ||
    `${chatId}:${pickStr(m.timestamp) || pickStr(m.created_at) || index}:${messageText(m).slice(0, 40)}`
  );
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

type PersonRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  linkedinProviderId: string | null;
};

function normSlug(s: string): string {
  try {
    return decodeURIComponent(s.trim().toLowerCase());
  } catch {
    return s.trim().toLowerCase();
  }
}

function pushSlugHint(out: Set<string>, raw: unknown) {
  if (typeof raw !== "string" || !raw.trim()) return;
  const id = extractLinkedInProfileIdentifier(raw.trim());
  if (id && !isLinkedInProviderMemberId(id)) out.add(normSlug(id));
}

/** Vanity / public_id hints on the Unipile message (counterparty side). */
function collectSlugHintsFromMessage(m: Record<string, unknown>, selfId: string): string[] {
  const out = new Set<string>();
  const fromSelf = isFromSelf(m, selfId);
  if (!fromSelf) {
    pushSlugHint(out, m.public_identifier);
    pushSlugHint(out, m.public_id);
    const sender = m.sender;
    if (sender && typeof sender === "object") {
      const o = sender as Record<string, unknown>;
      pushSlugHint(out, o.public_identifier);
      pushSlugHint(out, o.public_id);
      pushSlugHint(out, o.attendee_public_id);
    }
  } else {
    pushSlugHint(out, m.recipient_public_identifier);
    const rec = m.recipient;
    if (rec && typeof rec === "object") {
      const o = rec as Record<string, unknown>;
      pushSlugHint(out, o.public_identifier);
      pushSlugHint(out, o.public_id);
    }
    const attendees = m.attendees;
    if (Array.isArray(attendees)) {
      for (const a of attendees) {
        if (a && typeof a === "object") {
          const o = a as Record<string, unknown>;
          const pid = pickStr(o.provider_id) || pickStr(o.attendee_provider_id);
          if (pid && pid !== selfId) {
            pushSlugHint(out, o.public_identifier);
            pushSlugHint(out, o.public_id);
          }
        }
      }
    }
  }
  return [...out];
}

type PersonLookup = {
  byProviderId: Map<string, PersonRow>;
  /** Lowercased LinkedIn /in/ slug from CRM URL → person */
  bySlug: Map<string, PersonRow>;
};

type PersonLookupLoad = {
  lookup: PersonLookup;
  /** Rows from `person` with deletedAt null (0 if query failed or dev-store). */
  crmPersonCount: number;
};

/** Merge LinkedIn URLs per person id; earlier `sources` win (full coalesce preferred over fallbacks). */
async function mergeLinkedInUrlsByPersonId(
  urlById: Map<string, string>,
  sql: string
): Promise<void> {
  try {
    const rows = await query<Record<string, unknown>>(sql);
    for (const r of rows) {
      const id = r.id != null ? String(r.id) : "";
      if (!id) continue;
      const u = r.liUrl != null ? String(r.liUrl).trim() : "";
      if (!u || urlById.has(id)) continue;
      urlById.set(id, u);
    }
  } catch {
    /* column or jsonb shape differs — try next variant */
  }
}

/**
 * Load persons and LinkedIn identity for matching Unipile messages.
 * Uses a base `person` SELECT plus several URL extracts so Twenty data in flat vs JSONB columns is still found.
 */
async function loadPersonLookup(): Promise<PersonLookupLoad> {
  const byProviderId = new Map<string, PersonRow>();
  const bySlug = new Map<string, PersonRow>();

  const ingestRow = (r: Record<string, unknown>, liUrlRaw: string | null) => {
    const id = String(r.id);
    const firstName = r.firstName != null ? String(r.firstName) : null;
    const lastName = r.lastName != null ? String(r.lastName) : null;
    const linkedinProviderId =
      r.linkedinProviderId != null ? String(r.linkedinProviderId).trim() : "";
    const p: PersonRow = {
      id,
      firstName,
      lastName,
      linkedinProviderId: linkedinProviderId || null,
    };
    if (linkedinProviderId && isLinkedInProviderMemberId(linkedinProviderId)) {
      byProviderId.set(linkedinProviderId, p);
    }
    const url = (liUrlRaw || "").trim();
    if (url) {
      const slug = extractLinkedInProfileIdentifier(url);
      if (slug && !isLinkedInProviderMemberId(slug)) {
        const k = normSlug(slug);
        if (!bySlug.has(k)) bySlug.set(k, p);
      }
    }
  };

  let baseRows: Record<string, unknown>[] = [];
  try {
    baseRows = await query<Record<string, unknown>>(
      `SELECT p.id, p."nameFirstName" AS "firstName", p."nameLastName" AS "lastName",
              p."linkedinProviderId" AS "linkedinProviderId"
       FROM person p WHERE p."deletedAt" IS NULL`
    );
  } catch (e) {
    // Older CRM DBs without migrate-person-linkedin-provider.sql — still load people for URL/slug match.
    if (postgresMissingColumn(e, "linkedinProviderId")) {
      try {
        baseRows = await query<Record<string, unknown>>(
          `SELECT p.id, p."nameFirstName" AS "firstName", p."nameLastName" AS "lastName",
                  NULL::text AS "linkedinProviderId"
           FROM person p WHERE p."deletedAt" IS NULL`
        );
      } catch {
        return { lookup: { byProviderId, bySlug }, crmPersonCount: 0 };
      }
    } else {
      return { lookup: { byProviderId, bySlug }, crmPersonCount: 0 };
    }
  }

  const urlById = new Map<string, string>();
  await mergeLinkedInUrlsByPersonId(
    urlById,
    `SELECT p.id, ${sqlPersonLinkedinUrlCoalesce("p")} AS "liUrl"
     FROM person p WHERE p."deletedAt" IS NULL`
  );
  await mergeLinkedInUrlsByPersonId(
    urlById,
    `SELECT p.id, NULLIF(TRIM(p."linkedinLinkPrimaryLinkUrl"), '') AS "liUrl"
     FROM person p WHERE p."deletedAt" IS NULL`
  );
  await mergeLinkedInUrlsByPersonId(
    urlById,
    `SELECT p.id,
            COALESCE(
              NULLIF(TRIM(p."linkedinUrl"->>'value'), ''),
              NULLIF(TRIM(p."linkedinUrl"->>'primaryLinkUrl'), ''),
              NULLIF(TRIM(p."linkedinUrl"->'primaryLinkUrl'->>'value'), '')
            ) AS "liUrl"
     FROM person p WHERE p."deletedAt" IS NULL`
  );
  await mergeLinkedInUrlsByPersonId(
    urlById,
    `SELECT p.id,
            COALESCE(
              NULLIF(TRIM(p."linkedinLink"->>'primaryLinkUrl'), ''),
              NULLIF(TRIM(p."linkedinLink"->'primaryLinkUrl'->>'value'), ''),
              NULLIF(TRIM(p."linkedinLink"->>'url'), '')
            ) AS "liUrl"
     FROM person p WHERE p."deletedAt" IS NULL`
  );

  for (const r of baseRows) {
    const id = r.id != null ? String(r.id) : "";
    const liUrl = id ? urlById.get(id) ?? null : null;
    ingestRow(r, liUrl);
  }

  return {
    lookup: { byProviderId, bySlug },
    crmPersonCount: baseRows.length,
  };
}

async function slugFromUnipileMemberId(
  providerMemberId: string,
  cache: Map<string, string>,
  counter: { used: number },
  maxLookups: number
): Promise<string | null> {
  if (counter.used >= maxLookups) return null;
  if (cache.has(providerMemberId)) {
    const s = cache.get(providerMemberId)!;
    return s || null;
  }
  counter.used += 1;
  const data = await fetchUnipileLinkedInProfile(providerMemberId);
  const pub = extractUnipilePublicIdentifierFromProfile(data);
  const norm = pub ? normSlug(pub) : "";
  cache.set(providerMemberId, norm);
  return norm || null;
}

async function resolvePersonForMessage(
  m: Record<string, unknown>,
  selfId: string,
  fallbackCp: string | null,
  lookup: PersonLookup,
  profileCache: Map<string, string>,
  profileCounter: { used: number },
  maxProfileLookups: number
): Promise<PersonRow | null> {
  const cp = counterpartyProviderId(m, selfId, fallbackCp);
  if (cp) {
    const hit = lookup.byProviderId.get(cp);
    if (hit) return hit;
  }
  for (const slug of collectSlugHintsFromMessage(m, selfId)) {
    const hit = lookup.bySlug.get(slug);
    if (hit) return hit;
  }
  if (cp && isLinkedInProviderMemberId(cp)) {
    const slug = await slugFromUnipileMemberId(cp, profileCache, profileCounter, maxProfileLookups);
    if (slug) {
      const hit = lookup.bySlug.get(slug);
      if (hit) return hit;
    }
  }
  return null;
}

function personDisplayName(p: PersonRow): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || "Contact";
}

async function maybeInsertMessageChunk(input: {
  topicId: string;
  person: PersonRow;
  chatId: string;
  messageId: string;
  direction: "out" | "in";
  occurredAt: string;
  body: string;
  dryRun: boolean;
  embedCap: { remaining: number };
}): Promise<"inserted" | "skip_dup" | "skip_cap"> {
  const text = input.body.trim();
  if (text.length < 2) return "skip_dup";
  const externalRef = `unipileMsg:${input.messageId}`;
  if (await knowledgeChunkExistsByExternalRef("tim", externalRef)) return "skip_dup";
  if (input.embedCap.remaining <= 0) return "skip_cap";
  const content = [
    `[LinkedIn · Tim corpus] ${personDisplayName(input.person)} · ${input.direction === "out" ? "outbound (Govind)" : "inbound"} · ${input.occurredAt}`,
    "",
    text,
  ].join("\n");
  if (input.dryRun) {
    input.embedCap.remaining -= 1;
    return "inserted";
  }
  await insertAgentKnowledgeChunk({
    agentId: "tim",
    topicId: input.topicId,
    content,
    metadata: {
      externalRef,
      source: "unipile_message",
      personId: input.person.id,
      chatId: input.chatId,
      messageId: input.messageId,
      direction: input.direction,
      occurredAt: input.occurredAt,
    },
    embedPurpose: "tim_crm_ingest",
  });
  input.embedCap.remaining -= 1;
  return "inserted";
}

async function ingestNotesForLinkedInPersons(input: {
  topicId: string;
  dryRun: boolean;
  maxNotes: number;
  embedCap: { remaining: number };
}): Promise<{ seen: number; inserted: number; skippedDup: number }> {
  let seen = 0;
  let inserted = 0;
  let skippedDup = 0;
  const noteRowsSelect = (linkedinPidPredicate: string) =>
    `SELECT n.id, n.title, n."bodyV2Markdown" AS body, n."createdAt" AS "createdAt",
            nt."targetPersonId" AS "personId",
            p."nameFirstName" AS "firstName", p."nameLastName" AS "lastName"
     FROM note n
     JOIN "noteTarget" nt ON nt."noteId" = n.id AND nt."deletedAt" IS NULL
     JOIN person p ON p.id = nt."targetPersonId" AND p."deletedAt" IS NULL
     WHERE n."deletedAt" IS NULL
       AND (${linkedinPidPredicate})
     ORDER BY n."createdAt" DESC
     LIMIT $1`;
  try {
    let rows: Record<string, unknown>[];
    try {
      rows = await query<Record<string, unknown>>(
        noteRowsSelect(
          `(p."linkedinProviderId" IS NOT NULL AND trim(p."linkedinProviderId") <> '')
           OR (NULLIF(TRIM(${sqlPersonLinkedinUrlCoalesce("p")}), '') IS NOT NULL)`
        ),
        [input.maxNotes]
      );
    } catch (e) {
      if (!postgresMissingColumn(e, "linkedinProviderId")) throw e;
      rows = await query<Record<string, unknown>>(
        noteRowsSelect(`NULLIF(TRIM(${sqlPersonLinkedinUrlCoalesce("p")}), '') IS NOT NULL`),
        [input.maxNotes]
      );
    }
    for (const r of rows) {
      if (input.embedCap.remaining <= 0) break;
      seen += 1;
      const noteId = String(r.id);
      const personId = String(r.personId);
      const title = r.title != null ? String(r.title) : "";
      const body = r.body != null ? String(r.body) : "";
      const createdAt = r.createdAt != null ? String(r.createdAt) : "";
      const name = [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || "Contact";
      const externalRef = `twentyNote:${noteId}`;
      if (await knowledgeChunkExistsByExternalRef("tim", externalRef)) {
        skippedDup += 1;
        continue;
      }
      const content = [
        `[CRM note · Tim corpus] ${name} · ${createdAt.slice(0, 19)}`,
        title ? `Title: ${title}` : "",
        "",
        body.slice(0, 12000),
      ]
        .filter(Boolean)
        .join("\n");
      if (input.dryRun) {
        inserted += 1;
        input.embedCap.remaining -= 1;
        continue;
      }
      await insertAgentKnowledgeChunk({
        agentId: "tim",
        topicId: input.topicId,
        content,
        metadata: {
          externalRef,
          source: "twenty_note",
          personId,
          noteId,
          title,
          occurredAt: createdAt,
        },
        embedPurpose: "tim_crm_ingest",
      });
      inserted += 1;
      input.embedCap.remaining -= 1;
    }
  } catch {
    /* schema */
  }
  return { seen, inserted, skippedDup };
}

/**
 * Pull LinkedIn chats/messages from Unipile and CRM notes into Tim’s Knowledge Studio CRM mirror topic.
 */
export async function runTimCrmKnowledgeSync(
  opts: TimCrmSyncOptions
): Promise<TimCrmSyncResult> {
  const errors: string[] = [];
  const topic = await ensureTimCrmMirrorKbTopic();
  const topicId = topic.id;
  const selfId = SELF_PROVIDER_DEFAULT;
  const maxNew = Math.max(1, Math.min(5000, opts.maxNewChunks ?? 400));
  const embedCap = { remaining: maxNew };

  const result: TimCrmSyncResult = {
    ok: true,
    topicId,
    chatsProcessed: 0,
    messagesSeen: 0,
    messagesInserted: 0,
    messagesSkippedDuplicate: 0,
    messagesSkippedNoPerson: 0,
    unmatchedChats: 0,
    notesSeen: 0,
    notesInserted: 0,
    notesSkippedDuplicate: 0,
    stoppedByCap: false,
    errors,
  };

  const accountId = process.env.UNIPILE_ACCOUNT_ID?.trim();
  if (!accountId || !process.env.UNIPILE_API_KEY?.trim() || !normalizeUnipileDsn(process.env.UNIPILE_DSN)) {
    errors.push("Unipile not configured (UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_ACCOUNT_ID).");
    result.ok = false;
    return result;
  }

  const maxProfileLookups = Math.max(0, Math.min(500, opts.maxProfileLookups ?? 80));
  const { lookup: personLookup, crmPersonCount } = await loadPersonLookup();
  if (personLookup.byProviderId.size === 0 && personLookup.bySlug.size === 0) {
    if (crmPersonCount === 0) {
      errors.push(
        "CRM returned no person rows (check CRM_DB_* / workspace schema, or .dev-store mode cannot run person SELECT — use Postgres with CRM_DB_PASSWORD)."
      );
    } else {
      errors.push(
        `CRM has ${crmPersonCount} person(s) but none have a usable LinkedIn identity — set linkedinProviderId (ACoA…) and/or a profile URL (linkedinLinkPrimaryLinkUrl or linkedinUrl / linkedinLink JSON) so Unipile can match.`
      );
    }
  }

  const profileCache = new Map<string, string>();
  const profileCounter = { used: 0 };

  const chatLimit = Math.min(80, Math.max(1, opts.chatLimit));
  const msgLimit = Math.min(100, Math.max(1, opts.messagesPerChat));

  logTimKbSync("start", {
    chatLimit,
    msgLimit,
    maxNewEmbeds: maxNew,
    dryRun: opts.dryRun,
    includeNotes: opts.includeNotes,
  });

  const listPath = `/chats?account_id=${encodeURIComponent(accountId)}&account_type=LINKEDIN&limit=${chatLimit}`;
  const listRes = await unipileGetJson(listPath);
  if (!listRes.ok) {
    errors.push(`Unipile list chats failed: HTTP ${listRes.status} ${JSON.stringify(listRes.body).slice(0, 400)}`);
    result.ok = false;
    return result;
  }

  const listBody = listRes.body as Record<string, unknown>;
  const items = listBody.items || listBody.data;
  const chats = Array.isArray(items) ? items : [];
  logTimKbSync(`listed ${chats.length} LinkedIn chat(s) from Unipile`);

  for (const c of chats) {
    if (embedCap.remaining <= 0) {
      result.stoppedByCap = true;
      break;
    }
    const chat = c as Record<string, unknown>;
    const chatId = pickStr(chat.id) || pickStr(chat.chat_id);
    if (!chatId) continue;
    result.chatsProcessed += 1;

    const msgRes = await unipileGetJson(
      `/chats/${encodeURIComponent(chatId)}/messages?limit=${msgLimit}`
    );
    if (!msgRes.ok) {
      errors.push(`messages ${chatId}: HTTP ${msgRes.status}`);
      result.unmatchedChats += 1;
      continue;
    }
    const msgBody = msgRes.body as Record<string, unknown>;
    const rawMsgs = msgBody.items || msgBody.data;
    const messages = Array.isArray(rawMsgs) ? rawMsgs : [];
    logTimKbSync(
      `chat ${result.chatsProcessed}/${chats.length}`,
      chatId,
      `messages=${messages.length}`,
      `embeds_remaining=${embedCap.remaining}`
    );

    let fallbackCp: string | null = null;
    for (const raw of messages) {
      const m = raw as Record<string, unknown>;
      if (!isFromSelf(m, selfId)) {
        const ids = collectProviderIds(m).filter((id) => id !== selfId);
        fallbackCp = ids[0] ?? null;
        break;
      }
    }

    let chatHadMatch = false;
    for (let i = 0; i < messages.length; i++) {
      if (embedCap.remaining <= 0) {
        result.stoppedByCap = true;
        break;
      }
      const m = messages[i] as Record<string, unknown>;
      result.messagesSeen += 1;
      const person = await resolvePersonForMessage(
        m,
        selfId,
        fallbackCp,
        personLookup,
        profileCache,
        profileCounter,
        maxProfileLookups
      );
      if (!person) {
        result.messagesSkippedNoPerson += 1;
        continue;
      }
      chatHadMatch = true;
      const dir: "out" | "in" = isFromSelf(m, selfId) ? "out" : "in";
      const ts =
        pickStr(m.timestamp) || pickStr(m.created_at) || new Date().toISOString();
      const mid = messageId(m, chatId, i);
      const txt = messageText(m);
      const ins = await maybeInsertMessageChunk({
        topicId,
        person,
        chatId,
        messageId: mid,
        direction: dir,
        occurredAt: ts,
        body: txt,
        dryRun: opts.dryRun,
        embedCap,
      });
      if (ins === "inserted") result.messagesInserted += 1;
      else if (ins === "skip_dup") result.messagesSkippedDuplicate += 1;
      else if (ins === "skip_cap") {
        result.stoppedByCap = true;
        break;
      }
    }
    if (!chatHadMatch && messages.length > 0) result.unmatchedChats += 1;
  }

  if (opts.includeNotes && embedCap.remaining > 0) {
    logTimKbSync("ingesting CRM notes for LinkedIn persons…");
    const n = await ingestNotesForLinkedInPersons({
      topicId,
      dryRun: opts.dryRun,
      maxNotes: 500,
      embedCap,
    });
    result.notesSeen = n.seen;
    result.notesInserted = n.inserted;
    result.notesSkippedDuplicate = n.skippedDup;
    if (embedCap.remaining <= 0) result.stoppedByCap = true;
  }

  if (!opts.dryRun && (result.messagesInserted > 0 || result.notesInserted > 0)) {
    await touchKbTopicLastSync(topicId);
  }

  logTimKbSync("done", {
    ok: result.ok,
    chatsProcessed: result.chatsProcessed,
    messagesSeen: result.messagesSeen,
    messagesInserted: result.messagesInserted,
    messagesSkippedDuplicate: result.messagesSkippedDuplicate,
    messagesSkippedNoPerson: result.messagesSkippedNoPerson,
    notesInserted: result.notesInserted,
    stoppedByCap: result.stoppedByCap,
    errorCount: result.errors.length,
  });

  return result;
}
