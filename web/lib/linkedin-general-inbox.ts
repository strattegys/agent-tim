/**
 * Unmatched LinkedIn webhook events → Tim’s active work queue (general inbox workflow).
 * Packaged warm-outreach / linkedin-outreach steps are handled elsewhere before this runs.
 */
import { query } from "@/lib/db";
import { personHasNonSystemBlockingPackagedWorkflow } from "@/lib/person-packaged-workflow-exclusivity";
import {
  extractLinkedInHintFromArtifactOrNotes,
  isLinkedInProviderMemberId,
  linkedinUrlJsonCoalesceUnsupported,
  postgresMissingColumn,
  sqlPersonLinkedinUrlCoalesce,
} from "@/lib/linkedin-person-identity";
import {
  findLinkedinOutreachItemsAtInitiated,
  resolvePostgresPersonIdsForLinkedInSender,
} from "@/lib/warm-outreach-inbound-reply";
import { applyUnipileResearchToPerson } from "@/lib/warm-contact-intake-apply";
import { syncHumanTaskOpenForItem } from "@/lib/workflow-item-human-task";
import { ensureTimLinkedInSystemPackageWorkflow } from "@/lib/ensure-tim-linkedin-system-package-workflow";
import { fetchUnipileLinkedInProfile, isUnipileConfigured } from "@/lib/unipile-profile";

const GENERAL_STAGE = "LINKEDIN_INBOUND";

let ensureWorkflowPromise: Promise<string> | null = null;

/** Lazy-create the single Tim general-inbox workflow (always under its system package). */
export async function ensureGeneralLinkedInInboxWorkflowId(): Promise<string> {
  if (!ensureWorkflowPromise) {
    ensureWorkflowPromise = (async () =>
      ensureTimLinkedInSystemPackageWorkflow("general-inbox"))();
  }
  return ensureWorkflowPromise;
}

/**
 * Resolve a single Postgres `person.id` for LinkedIn inbound (Twenty id, LinkedIn URL, provider id, name),
 * creating a minimal row when needed (same rules as general inbox).
 */
export async function resolvePrimaryPostgresPersonForLinkedInInbound(args: {
  crmContactId: string;
  senderProviderId: string;
  senderDisplayName: string;
}): Promise<string | null> {
  let personIds = await resolvePostgresPersonIdsForLinkedInSender(
    args.crmContactId,
    args.senderProviderId,
    args.senderDisplayName
  );
  if (personIds.length === 0) {
    return ensurePostgresPersonForLinkedInInbound(args);
  }
  return personIds[0] ?? null;
}

/**
 * When no existing `person` row matches the sender, create a minimal Postgres contact so Tim’s
 * general inbox can still attach a workflow item (simple inbound → queue path).
 */
async function ensurePostgresPersonForLinkedInInbound(args: {
  crmContactId: string;
  senderProviderId: string;
  senderDisplayName: string;
}): Promise<string | null> {
  const slug = args.senderProviderId?.trim();
  if (!slug) return null;

  const urlVanity = isLinkedInProviderMemberId(slug)
    ? null
    : `https://www.linkedin.com/in/${slug}`;
  const likeSlug = `%${slug}%`;
  const likePath = `%/in/${slug}%`;

  try {
    const dup = await query<{ id: string }>(
      `SELECT id FROM person
       WHERE "deletedAt" IS NULL
         AND (
           TRIM(COALESCE("linkedinProviderId", '')) = $1
           OR "linkedinLinkPrimaryLinkUrl" ILIKE $2
           OR "linkedinLinkPrimaryLinkUrl" ILIKE $3
         )
       LIMIT 1`,
      [slug, likeSlug, likePath]
    );
    if (dup.length > 0) return dup[0].id;
  } catch (e) {
    if (!postgresMissingColumn(e, "linkedinProviderId")) throw e;
    const dup = await query<{ id: string }>(
      `SELECT id FROM person
       WHERE "deletedAt" IS NULL
         AND ("linkedinLinkPrimaryLinkUrl" ILIKE $1 OR "linkedinLinkPrimaryLinkUrl" ILIKE $2)
       LIMIT 1`,
      [likeSlug, likePath]
    );
    if (dup.length > 0) return dup[0].id;
  }

  const name = args.senderDisplayName?.trim() || "LinkedIn contact";
  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "LinkedIn";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "Inbound";
  const jobTitle = "LinkedIn inbound (auto — verify in CRM)";
  const providerVal = isLinkedInProviderMemberId(slug) ? slug : null;

  try {
    const ins = await query<{ id: string }>(
      `INSERT INTO person ("nameFirstName", "nameLastName", "jobTitle", "linkedinLinkPrimaryLinkUrl", "linkedinProviderId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id`,
      [firstName, lastName, jobTitle, urlVanity, providerVal]
    );
    return ins[0]?.id ?? null;
  } catch (e) {
    if (postgresMissingColumn(e, "linkedinProviderId")) {
      const ins2 = await query<{ id: string }>(
        `INSERT INTO person ("nameFirstName", "nameLastName", "jobTitle", "linkedinLinkPrimaryLinkUrl", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
        [firstName, lastName, jobTitle, urlVanity]
      );
      return ins2[0]?.id ?? null;
    }
    throw e;
  }
}

function coalesceArtifactContentForHeal(raw: string | null | undefined): string {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return "";
  if (s.startsWith("{") && s.endsWith("}")) {
    try {
      const o = JSON.parse(s) as Record<string, unknown>;
      for (const k of ["markdown", "text", "body", "content", "value"]) {
        const v = o[k];
        if (typeof v === "string" && v.trim()) return v;
      }
    } catch {
      /* plain text */
    }
  }
  return s;
}

/**
 * Persist Unipile sender id / vanity from webhooks onto `person` so thread load and sends work.
 * When the id is ACoA… and Unipile is configured, merges public profile into the CRM row.
 */
export async function ensurePersonLinkedInFromUnipileWebhook(
  personId: string,
  senderProviderId: string
): Promise<void> {
  const slug = senderProviderId?.trim();
  if (!slug) return;

  if (isLinkedInProviderMemberId(slug)) {
    try {
      await query(
        `UPDATE person SET "linkedinProviderId" = $1, "updatedAt" = NOW()
         WHERE id = $2::uuid AND "deletedAt" IS NULL`,
        [slug, personId]
      );
    } catch (e) {
      if (!postgresMissingColumn(e, "linkedinProviderId")) throw e;
    }
  } else {
    const url = `https://www.linkedin.com/in/${slug.replace(/^\/+/, "")}`;
    await query(
      `UPDATE person SET
         "linkedinLinkPrimaryLinkUrl" = COALESCE(NULLIF(TRIM("linkedinLinkPrimaryLinkUrl"), ''), $1),
         "updatedAt" = NOW()
       WHERE id = $2::uuid AND "deletedAt" IS NULL`,
      [url, personId]
    );
  }

  if (isLinkedInProviderMemberId(slug) && isUnipileConfigured()) {
    try {
      const raw = await fetchUnipileLinkedInProfile(slug);
      const logs: string[] = [];
      await applyUnipileResearchToPerson(personId, raw, logs);
    } catch (e) {
      console.warn("[linkedin-general-inbox] Unipile profile sync after webhook resolve:", e);
    }
  }
}

/**
 * If the person row has no LinkedIn fields yet, copy **Provider id** / URL hints from this queue item’s artifacts
 * (connection-acceptance or general-inbox snapshots) and persist them. Used before Tim’s queue lists rows and on thread GET.
 */
export async function healPersonLinkedInFromWorkflowArtifactsIfNeeded(
  personId: string,
  workflowItemId: string | null
): Promise<boolean> {
  const wid = workflowItemId?.trim();
  if (!wid) return false;

  let hasUrl = false;
  let hasProvider = false;
  try {
    const rows = await query<{ u: string | null; p: string | null }>(
      `SELECT ${sqlPersonLinkedinUrlCoalesce("p")} AS u, p."linkedinProviderId" AS p
       FROM person p WHERE p.id = $1::uuid AND p."deletedAt" IS NULL LIMIT 1`,
      [personId]
    );
    const r = rows[0];
    if (r) {
      hasUrl = Boolean((r.u || "").trim());
      hasProvider = Boolean((r.p || "").trim());
    }
  } catch (e) {
    if (linkedinUrlJsonCoalesceUnsupported(e)) {
      const rows = await query<{ u: string | null; p: string | null }>(
        `SELECT NULLIF(TRIM(p."linkedinLinkPrimaryLinkUrl"), '') AS u, p."linkedinProviderId" AS p
         FROM person p WHERE p.id = $1::uuid AND p."deletedAt" IS NULL LIMIT 1`,
        [personId]
      );
      const r = rows[0];
      if (r) {
        hasUrl = Boolean((r.u || "").trim());
        hasProvider = Boolean((r.p || "").trim());
      }
    } else if (postgresMissingColumn(e, "linkedinProviderId")) {
      const rows = await query<{ u: string | null }>(
        `SELECT ${sqlPersonLinkedinUrlCoalesce("p")} AS u
         FROM person p WHERE p.id = $1::uuid AND p."deletedAt" IS NULL LIMIT 1`,
        [personId]
      );
      hasUrl = Boolean((rows[0]?.u || "").trim());
    } else {
      throw e;
    }
  }
  if (hasUrl || hasProvider) return false;

  const artRows = await query<{ content: string }>(
    `SELECT a.content::text AS content
     FROM "_artifact" a
     WHERE a."workflowItemId" = $1::uuid AND a."deletedAt" IS NULL
     ORDER BY a."createdAt" DESC NULLS LAST
     LIMIT 25`,
    [wid]
  );
  const blob = artRows
    .map((row) => coalesceArtifactContentForHeal(row.content))
    .filter(Boolean)
    .join("\n\n");
  const hint = extractLinkedInHintFromArtifactOrNotes(blob);
  if (!hint?.trim()) return false;

  await ensurePersonLinkedInFromUnipileWebhook(personId, hint);
  return true;
}

async function findOpenGeneralInboxItem(
  workflowId: string,
  personId: string
): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `SELECT wi.id
     FROM "_workflow_item" wi
     WHERE wi."workflowId" = $1
       AND wi."sourceType" = 'person'
       AND wi."sourceId" = $2
       AND UPPER(TRIM(wi.stage::text)) = $3
       AND wi."deletedAt" IS NULL
     ORDER BY wi."updatedAt" DESC NULLS LAST, wi."createdAt" DESC
     LIMIT 1`,
    [workflowId, personId, GENERAL_STAGE]
  );
  return rows[0]?.id ?? null;
}

/**
 * Multiple active LINKEDIN_INBOUND rows for the same person (race, retries, or ID resolution drift)
 * duplicate Tim’s queue. Keep the newest row, move artifacts onto it, soft-delete the rest.
 */
async function mergeDuplicateActiveGeneralInboxInboundRows(
  workflowId: string,
  personId: string
): Promise<void> {
  const rows = await query<{ id: string }>(
    `SELECT wi.id
     FROM "_workflow_item" wi
     WHERE wi."workflowId" = $1
       AND wi."sourceType" = 'person'
       AND wi."sourceId" = $2
       AND UPPER(TRIM(wi.stage::text)) = $3
       AND wi."deletedAt" IS NULL
     ORDER BY wi."updatedAt" DESC NULLS LAST, wi."createdAt" DESC`,
    [workflowId, personId, GENERAL_STAGE]
  );
  if (rows.length <= 1) return;
  const keeper = rows[0].id;
  for (let i = 1; i < rows.length; i++) {
    const loserId = rows[i].id;
    await query(
      `UPDATE "_artifact"
       SET "workflowItemId" = $1::uuid, "updatedAt" = NOW()
       WHERE "workflowItemId" = $2::uuid AND "deletedAt" IS NULL`,
      [keeper, loserId]
    );
    await query(
      `UPDATE "_workflow_item"
       SET "deletedAt" = NOW(), "humanTaskOpen" = false, "updatedAt" = NOW()
       WHERE id = $1::uuid`,
      [loserId]
    );
  }
}

/**
 * Row for this person on the general-inbox workflow (unique on workflow + sourceType + sourceId).
 * Prefers active rows; if only a soft-deleted row exists, revives it so new artifacts can attach.
 */
async function findGeneralInboxWorkflowItemForPerson(
  workflowId: string,
  personId: string
): Promise<string | null> {
  const rows = await query<{ id: string; deletedAt: Date | null }>(
    `SELECT wi.id, wi."deletedAt"
     FROM "_workflow_item" wi
     WHERE wi."workflowId" = $1
       AND wi."sourceType" = 'person'
       AND wi."sourceId" = $2
     ORDER BY (wi."deletedAt" IS NULL) DESC, wi."updatedAt" DESC NULLS LAST
     LIMIT 1`,
    [workflowId, personId]
  );
  const r = rows[0];
  if (!r) return null;
  if (r.deletedAt != null) {
    await query(
      `UPDATE "_workflow_item" SET "deletedAt" = NULL, "updatedAt" = NOW() WHERE id = $1`,
      [r.id]
    );
  }
  return r.id;
}

/** Replace auto-created "LinkedIn" / "Unknown" contact names when Unipile gives a real display name. */
async function refreshInboundPersonDisplayNameIfPlaceholder(
  personId: string,
  displayName: string
): Promise<void> {
  const name = displayName.trim();
  if (!name || name.toLowerCase() === "unknown") return;
  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || "";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "Inbound";
  if (!firstName) return;

  try {
    const rows = await query<{ fn: string; ln: string }>(
      `SELECT TRIM(COALESCE("nameFirstName", '')) AS fn, TRIM(COALESCE("nameLastName", '')) AS ln
       FROM person WHERE id = $1 AND "deletedAt" IS NULL`,
      [personId]
    );
    const r = rows[0];
    if (!r) return;
    const fn = r.fn.toLowerCase();
    const ln = r.ln.toLowerCase();
    const placeholder =
      fn === "" ||
      fn === "unknown" ||
      fn === "linkedin" ||
      (fn === "linkedin" && ln === "inbound");
    if (!placeholder) return;

    await query(
      `UPDATE person
       SET "nameFirstName" = $2, "nameLastName" = $3, "updatedAt" = NOW()
       WHERE id = $1 AND "deletedAt" IS NULL`,
      [personId, firstName, lastName]
    );
  } catch (e) {
    if (postgresMissingColumn(e, "nameFirstName")) return;
    console.warn("[linkedin-general-inbox] refresh person display name:", e);
  }
}

/**
 * When no packaged workflow consumed the event, queue a Tim task with the payload in an artifact.
 * Inbound DMs only — connection acceptances use `recordLinkedInConnectionAccepted`.
 */
export async function recordGeneralLinkedInInbound(args: {
  crmContactId: string;
  senderProviderId: string;
  senderDisplayName: string;
  messageText?: string;
  chatId?: string;
  timestampIso?: string;
}): Promise<{ ok: boolean; reason?: string; workflowItemId?: string }> {
  const primaryPersonId = await resolvePrimaryPostgresPersonForLinkedInInbound({
    crmContactId: args.crmContactId,
    senderProviderId: args.senderProviderId,
    senderDisplayName: args.senderDisplayName,
  });
  if (!primaryPersonId) {
    return {
      ok: false,
      reason:
        "No Postgres person and could not create one — need Unipile sender id (attendee_provider_id) on the webhook payload.",
    };
  }

  await ensurePersonLinkedInFromUnipileWebhook(primaryPersonId, args.senderProviderId);

  if (await personHasNonSystemBlockingPackagedWorkflow(primaryPersonId)) {
    return {
      ok: false,
      reason:
        "Person is already on an active or planned package pipeline — skipping Tim LinkedIn general-inbox queue row (inbound still visible in Unipile).",
    };
  }

  await refreshInboundPersonDisplayNameIfPlaceholder(primaryPersonId, args.senderDisplayName);

  const workflowId = await ensureGeneralLinkedInInboxWorkflowId();
  await mergeDuplicateActiveGeneralInboxInboundRows(workflowId, primaryPersonId);
  const ts = args.timestampIso || new Date().toISOString();
  const body = [
    "## LinkedIn — inbound message (general inbox)",
    "",
    `**From:** ${args.senderDisplayName}`,
    args.senderProviderId ? `**Provider id:** ${args.senderProviderId}` : "",
    args.chatId ? `**Chat ID:** ${args.chatId}` : "",
    `**Recorded:** ${ts}`,
    "",
    args.messageText?.trim() || "_(empty body)_",
  ]
    .filter(Boolean)
    .join("\n");

  let itemId =
    (await findOpenGeneralInboxItem(workflowId, primaryPersonId)) ??
    (await findGeneralInboxWorkflowItemForPerson(workflowId, primaryPersonId));

  if (!itemId) {
    const ins = await query<{ id: string }>(
      `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "position", "createdAt", "updatedAt", "humanTaskOpen")
       VALUES ($1, $2, 'person', $3, 0, NOW(), NOW(), true)
       RETURNING id`,
      [workflowId, GENERAL_STAGE, primaryPersonId]
    );
    itemId = ins[0].id;
  }

  await query(
    `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [
      itemId,
      workflowId,
      GENERAL_STAGE,
      "LinkedIn: inbound message",
      "markdown",
      body,
    ]
  );

  await syncHumanTaskOpenForItem(itemId);
  return { ok: true, workflowItemId: itemId };
}

/** True if this person has a packaged linkedin-outreach row waiting on connection acceptance. */
export async function hasPackagedLinkedinOutreachPendingAcceptance(personId: string): Promise<boolean> {
  const ids = await findLinkedinOutreachItemsAtInitiated(personId);
  return ids.length > 0;
}
