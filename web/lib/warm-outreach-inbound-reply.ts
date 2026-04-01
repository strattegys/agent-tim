/**
 * When a LinkedIn inbound arrives, advance warm-outreach workflow items that are
 * at MESSAGED (same person) to REPLIED → REPLY_DRAFT via the same path as the human "Replied" action.
 */
import { query } from "@/lib/db";
import { isLinkedInProviderMemberId } from "@/lib/linkedin-person-identity";
import {
  loadCustomWorkflowTypeMap,
  resolveWorkflowRegistryForQueueWithCustomMap,
} from "@/lib/workflow-registry";
import {
  fetchUnipileLinkedInProfile,
  extractUnipilePublicIdentifierFromProfile,
  isUnipileConfigured,
} from "@/lib/unipile-profile";

/** Base URL for server-side fetch to this same Next app (webhook → /api/crm/human-tasks/resolve). */
function internalAppOrigin(): string {
  const raw =
    process.env.APP_INTERNAL_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (raw) return raw.replace(/\/$/, "");
  const port = process.env.PORT || "3001";
  // Same container / host as this process (Docker web listens on 0.0.0.0:PORT)
  return `http://127.0.0.1:${port}`;
}

export type PackagedWorkflowRegistryId = "warm-outreach" | "linkedin-outreach";

/**
 * Workflow items for a Postgres person at a given stage, filtered by resolved registry type (package board + spec).
 */
export async function findPersonWorkflowItemsAtStage(
  personId: string,
  stage: string,
  registryTypeId: PackagedWorkflowRegistryId
): Promise<string[]> {
  const stageNorm = (stage || "").trim().toUpperCase();
  const rows = await query<{
    id: string;
    spec: unknown;
    ownerAgent: string | null;
    board_stages: unknown;
    package_spec: unknown;
  }>(
    `SELECT wi.id, w.spec, w."ownerAgent", b.stages AS board_stages, p.spec AS package_spec
     FROM "_workflow_item" wi
     INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
     LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
     LEFT JOIN "_package" p ON p.id = w."packageId" AND p."deletedAt" IS NULL
     WHERE wi."sourceId" = $1
       AND wi."sourceType" = 'person'
       AND UPPER(TRIM(wi.stage::text)) = $2
       AND wi."deletedAt" IS NULL`,
    [personId, stageNorm]
  );
  const customMap = await loadCustomWorkflowTypeMap();
  const out: string[] = [];
  for (const r of rows) {
    const typeId = resolveWorkflowRegistryForQueueWithCustomMap(
      r.spec,
      {
        packageSpec: r.package_spec,
        ownerAgent: r.ownerAgent,
        boardStages: r.board_stages,
      },
      customMap
    );
    if (typeId === registryTypeId) out.push(r.id);
  }
  return out;
}

/** Workflow item IDs at MESSAGED for this person in a warm-outreach workflow. */
export async function findWarmOutreachItemsAwaitingReply(personId: string): Promise<string[]> {
  return findPersonWorkflowItemsAtStage(personId, "MESSAGED", "warm-outreach");
}

/** LinkedIn outreach (connection request) items still at INITIATED — package-handled acceptances. */
export async function findLinkedinOutreachItemsAtInitiated(personId: string): Promise<string[]> {
  return findPersonWorkflowItemsAtStage(personId, "INITIATED", "linkedin-outreach");
}

/**
 * Resolve `person.id` rows for a webhook sender (Twenty id may match Postgres UUID, else URL / Unipile / name fallbacks).
 */
export async function resolvePostgresPersonIdsForLinkedInSender(
  crmContactId: string,
  senderProviderId: string,
  senderDisplayName?: string
): Promise<string[]> {
  const seen = new Set<string>();

  if (crmContactId?.trim()) {
    const crm = crmContactId.trim();
    const byId = await query<{ id: string }>(
      `SELECT id FROM person WHERE id = $1::uuid AND "deletedAt" IS NULL`,
      [crm]
    );
    if (byId.length > 0) seen.add(byId[0].id);
  }

  const slug = senderProviderId?.trim();
  if (slug) {
    const rows = await query<{ id: string }>(
      `SELECT id FROM person
       WHERE "deletedAt" IS NULL
         AND "linkedinLinkPrimaryLinkUrl" IS NOT NULL
         AND TRIM("linkedinLinkPrimaryLinkUrl") <> ''
         AND (
           "linkedinLinkPrimaryLinkUrl" ILIKE $1
           OR "linkedinLinkPrimaryLinkUrl" ILIKE $2
         )`,
      [`%${slug}%`, `%/in/${slug}%`]
    );
    for (const r of rows) seen.add(r.id);
  }

  if (slug) {
    for (const pid of await postgresPersonIdsFromUnipileSenderId(slug)) seen.add(pid);
  }

  if (slug && isLinkedInProviderMemberId(slug)) {
    try {
      const rows = await query<{ id: string }>(
        `SELECT id FROM person
         WHERE "deletedAt" IS NULL
           AND TRIM(COALESCE("linkedinProviderId", '')) = $1`,
        [slug.trim()]
      );
      for (const r of rows) seen.add(r.id);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (!m.includes("linkedinProviderId")) throw e;
    }
  }

  if (senderDisplayName) {
    const parsed = splitInboundDisplayName(senderDisplayName);
    if (parsed) {
      const rows = await query<{ id: string }>(
        `SELECT id FROM person
         WHERE "deletedAt" IS NULL
           AND LOWER(TRIM(COALESCE("nameFirstName", ''))) = LOWER(TRIM($1))
           AND LOWER(TRIM(COALESCE("nameLastName", ''))) = LOWER(TRIM($2))`,
        [parsed.first, parsed.last]
      );
      for (const r of rows) seen.add(r.id);
    }
  }

  return [...seen];
}

/** Resolve Postgres `person.id` rows whose LinkedIn URL matches Unipile's public slug (vanity), when webhook sends ACoA… */
async function postgresPersonIdsFromUnipileSenderId(senderProviderId: string): Promise<string[]> {
  if (!isUnipileConfigured() || !senderProviderId.trim()) return [];
  const raw = await fetchUnipileLinkedInProfile(senderProviderId.trim());
  const pub = extractUnipilePublicIdentifierFromProfile(raw);
  if (!pub) return [];
  const inPath = `%/in/${pub}%`;
  const rows = await query<{ id: string }>(
    `SELECT id FROM person
     WHERE "deletedAt" IS NULL
       AND "linkedinLinkPrimaryLinkUrl" IS NOT NULL
       AND TRIM("linkedinLinkPrimaryLinkUrl") <> ''
       AND (
         "linkedinLinkPrimaryLinkUrl" ILIKE $1
         OR "linkedinLinkPrimaryLinkUrl" ILIKE $2
       )`,
    [inPath, `%linkedin.com/in/${pub}%`]
  );
  return rows.map((r) => r.id);
}

function splitInboundDisplayName(senderName: string): { first: string; last: string } | null {
  const t = senderName.trim();
  if (!t) return null;
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/**
 * Same as findWarmOutreachItemsAwaitingReply, but if the webhook CRM contact id does not match
 * `person.id` on the workflow item (Twenty/bash vs Postgres row), fall back to matching
 * `person.linkedinLinkPrimaryLinkUrl` against Unipile's provider id / slug, then Unipile profile
 * → public_identifier → URL match, then exact Postgres person name (only if exactly one MESSAGED item).
 */
export async function resolveWarmOutreachItemsForInboundMessage(
  crmContactId: string,
  senderProviderId: string,
  senderDisplayName?: string
): Promise<string[]> {
  const seen = new Set<string>();
  for (const id of await findWarmOutreachItemsAwaitingReply(crmContactId)) seen.add(id);

  const slug = senderProviderId?.trim();
  if (seen.size === 0 && slug) {
    const rows = await query<{ id: string }>(
      `SELECT id FROM person
       WHERE "deletedAt" IS NULL
         AND "linkedinLinkPrimaryLinkUrl" IS NOT NULL
         AND TRIM("linkedinLinkPrimaryLinkUrl") <> ''
         AND (
           "linkedinLinkPrimaryLinkUrl" ILIKE $1
           OR "linkedinLinkPrimaryLinkUrl" ILIKE $2
         )`,
      [`%${slug}%`, `%/in/${slug}%`]
    );
    for (const r of rows) {
      for (const wi of await findWarmOutreachItemsAwaitingReply(r.id)) seen.add(wi);
    }
  }

  if (seen.size === 0 && slug) {
    const personIds = await postgresPersonIdsFromUnipileSenderId(slug);
    for (const pid of personIds) {
      for (const wi of await findWarmOutreachItemsAwaitingReply(pid)) seen.add(wi);
    }
  }

  if (seen.size === 0 && slug && isLinkedInProviderMemberId(slug)) {
    try {
      const rows = await query<{ id: string }>(
        `SELECT id FROM person
         WHERE "deletedAt" IS NULL
           AND TRIM(COALESCE("linkedinProviderId", '')) = $1`,
        [slug.trim()]
      );
      for (const r of rows) {
        for (const wi of await findWarmOutreachItemsAwaitingReply(r.id)) seen.add(wi);
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (!m.includes("linkedinProviderId")) throw e;
    }
  }

  if (seen.size === 0 && senderDisplayName) {
    const parsed = splitInboundDisplayName(senderDisplayName);
    if (parsed) {
      const rows = await query<{ id: string }>(
        `SELECT id FROM person
         WHERE "deletedAt" IS NULL
           AND LOWER(TRIM(COALESCE("nameFirstName", ''))) = LOWER(TRIM($1))
           AND LOWER(TRIM(COALESCE("nameLastName", ''))) = LOWER(TRIM($2))`,
        [parsed.first, parsed.last]
      );
      const itemCandidates: string[] = [];
      for (const r of rows) {
        itemCandidates.push(...(await findWarmOutreachItemsAwaitingReply(r.id)));
      }
      if (itemCandidates.length === 1) {
        seen.add(itemCandidates[0]);
      } else if (itemCandidates.length > 1) {
        console.warn(
          `[warm-outreach-inbound] Name fallback ambiguous for "${senderDisplayName}" — ${itemCandidates.length} MESSAGED warm-outreach items; skip auto-advance`
        );
      }
    }
  }

  return [...seen];
}

/**
 * Server-side call into human-tasks resolve (replied + notes on MESSAGED).
 * Requires a reachable app URL (set APP_INTERNAL_URL in production if needed).
 */
export async function applyWarmOutreachInboundViaResolve(
  itemId: string,
  notes: string
): Promise<{ ok: boolean; error?: string }> {
  const origin = internalAppOrigin();
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const internalKey = process.env.INTERNAL_API_KEY?.trim();
    if (internalKey) headers["x-internal-key"] = internalKey;
    const whSecret = process.env.UNIPILE_WEBHOOK_SECRET?.trim();
    /* middleware allows resolve when Bearer OR unipile-auth matches (same as inbound webhook). */
    if (whSecret) {
      headers["Authorization"] = `Bearer ${whSecret}`;
      headers["unipile-auth"] = whSecret;
    }

    const res = await fetch(`${origin}/api/crm/human-tasks/resolve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ itemId, action: "replied", notes }),
    });
    const rawText = await res.text();
    let data: { ok?: boolean; error?: string } = {};
    try {
      data = JSON.parse(rawText) as { ok?: boolean; error?: string };
    } catch {
      console.warn(
        `[warm-outreach-inbound] resolve non-JSON response HTTP ${res.status} from ${origin}: ${rawText.slice(0, 200)}`
      );
      return { ok: false, error: `HTTP ${res.status} (non-JSON)` };
    }
    if (!data.ok) {
      const detail = data.error || rawText.slice(0, 300) || `HTTP ${res.status}`;
      return { ok: false, error: detail };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
