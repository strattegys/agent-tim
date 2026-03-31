/**
 * Unmatched LinkedIn webhook events → Tim’s active work queue (general inbox workflow).
 * Packaged warm-outreach / linkedin-outreach steps are handled elsewhere before this runs.
 */
import { query } from "@/lib/db";
import {
  isLinkedInProviderMemberId,
  postgresMissingColumn,
} from "@/lib/linkedin-person-identity";
import {
  findLinkedinOutreachItemsAtInitiated,
  resolvePostgresPersonIdsForLinkedInSender,
} from "@/lib/warm-outreach-inbound-reply";
import { syncHumanTaskOpenForItem } from "@/lib/workflow-item-human-task";
import { ensureTimLinkedInSystemPackageWorkflow } from "@/lib/ensure-tim-linkedin-system-package-workflow";

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
       AND wi."deletedAt" IS NULL`,
    [workflowId, personId, GENERAL_STAGE]
  );
  return rows[0]?.id ?? null;
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

  await refreshInboundPersonDisplayNameIfPlaceholder(primaryPersonId, args.senderDisplayName);

  const workflowId = await ensureGeneralLinkedInInboxWorkflowId();
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
