import { query } from "@/lib/db";
import {
  ensureIntakeNameFromRawLines,
  extractLinkedInUrlFromText,
  parseWarmContactIntake,
} from "@/lib/warm-contact-intake-parse";
import {
  extractLinkedInProfileIdentifier,
  extractUnipileProfileCrmFields,
  extractUnipileProviderIdFromProfile,
  fetchUnipileLinkedInProfile,
  isUnipileConfigured,
} from "@/lib/unipile-profile";
import {
  isLinkedInInboundAutoJobTitle,
  isWarmOutreachPlaceholderJobTitle,
} from "@/lib/warm-outreach-researching-guard";
import { WARM_DISCOVERY_SOURCE_TYPE } from "@/lib/warm-discovery-item";

function logTs(message: string): string {
  return `[${new Date().toISOString()}] ${message}`;
}

async function resolveOrCreateCompanyId(name: string, logs: string[]): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const found = await query<{ id: string }>(
    `SELECT id FROM company
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND "deletedAt" IS NULL
     LIMIT 1`,
    [trimmed]
  );
  if (found[0]?.id) return found[0].id;

  try {
    const ins = await query<{ id: string }>(
      `INSERT INTO company (id, name, "domainNamePrimaryLinkUrl", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, NULL, NOW(), NOW())
       RETURNING id`,
      [trimmed]
    );
    const id = ins[0]?.id ?? null;
    if (id) logs.push(logTs(`Warm contact intake: created company "${trimmed.slice(0, 60)}"`));
    return id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logs.push(logTs(`Warm contact intake: company insert skipped (${msg.slice(0, 120)})`));
    return null;
  }
}

async function findPersonIdByLinkedInHint(
  linkedinId: string | null,
  linkedinUrlFromParse: string | null,
  logs: string[]
): Promise<string | null> {
  const slugs = new Set<string>();
  if (linkedinId?.trim()) slugs.add(linkedinId.trim());
  const fromUrl = linkedinUrlFromParse?.trim()
    ? extractLinkedInProfileIdentifier(linkedinUrlFromParse.trim())
    : null;
  if (fromUrl?.trim()) slugs.add(fromUrl.trim());

  for (const slug of slugs) {
    if (!slug) continue;
    const likePat = `%linkedin.com/in/${slug.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    const rows = await query<{ id: string }>(
      `SELECT id FROM person
       WHERE "deletedAt" IS NULL
         AND NULLIF(TRIM("linkedinLinkPrimaryLinkUrl"), '') IS NOT NULL
         AND "linkedinLinkPrimaryLinkUrl" ILIKE $1 ESCAPE '\\'
       LIMIT 3`,
      [likePat]
    );
    const id = rows[0]?.id;
    if (id) {
      logs.push(logTs(`Warm discovery: matched existing CRM person ${id.slice(0, 8)}… by LinkedIn`));
      return id;
    }
  }
  return null;
}

export type WarmDiscoveryLinkResult = { personId: string } | { error: string };

/**
 * Links a `warm_discovery` workflow row to an existing or new `person` after Govind submits intake.
 * Updates `_workflow_item` to `sourceType = person` and applies parsed fields to the person row.
 */
export async function createOrLinkPersonForWarmDiscoveryItem(
  workflowItemId: string,
  notes: string,
  logs: string[]
): Promise<WarmDiscoveryLinkResult> {
  const items = await query<{
    id: string;
    stage: string;
    sourceType: string;
    sourceId: string;
  }>(
    `SELECT id, stage, "sourceType", "sourceId"
     FROM "_workflow_item"
     WHERE id = $1 AND "deletedAt" IS NULL`,
    [workflowItemId]
  );
  if (items.length === 0) return { error: "Workflow item not found." };
  const row = items[0];
  if (row.sourceType !== WARM_DISCOVERY_SOURCE_TYPE) {
    return { error: "This row is not an open warm discovery slot." };
  }
  const stage = (row.stage || "").trim().toUpperCase();
  if (stage !== "AWAITING_CONTACT") {
    return { error: "Warm discovery intake is only accepted in the AWAITING_CONTACT stage." };
  }

  let p = parseWarmContactIntake(notes);
  p = ensureIntakeNameFromRawLines(notes, p);

  const linkedinId =
    extractLinkedInProfileIdentifier(notes.trim()) ||
    (p.linkedinUrl?.trim() ? extractLinkedInProfileIdentifier(p.linkedinUrl.trim()) : null);

  if (linkedinId && isUnipileConfigured()) {
    const raw = await fetchUnipileLinkedInProfile(linkedinId);
    const u = extractUnipileProfileCrmFields(raw);
    if (u) {
      if (!p.firstName?.trim()) p = { ...p, firstName: u.firstName };
      if (!p.lastName?.trim() && u.lastName) p = { ...p, lastName: u.lastName };
      if (!p.jobTitle?.trim() && u.jobTitle) p = { ...p, jobTitle: u.jobTitle };
      if (!p.companyName?.trim() && u.companyName) p = { ...p, companyName: u.companyName };
      if (!p.linkedinUrl?.trim() && u.profileUrl) p = { ...p, linkedinUrl: u.profileUrl };
      logs.push(logTs("Warm discovery: merged fields from Unipile LinkedIn profile"));
    } else {
      logs.push(
        logTs(
          "Warm discovery: Unipile returned no usable name — check identifier, session, and API access"
        )
      );
    }
  } else if (linkedinId && !isUnipileConfigured()) {
    logs.push(
      logTs(
        "Warm discovery: LinkedIn URL/id in notes but Unipile is not configured — add Name: lines or set UNIPILE_* env vars"
      )
    );
  }

  const hasAny =
    (p.firstName && p.firstName.trim()) ||
    (p.lastName && p.lastName.trim()) ||
    (p.jobTitle && p.jobTitle.trim()) ||
    (p.companyName && p.companyName.trim()) ||
    (p.linkedinUrl && p.linkedinUrl.trim());

  if (!hasAny) {
    return {
      error:
        "Add a name, LinkedIn URL, company, or title in your notes so we can create or match a CRM contact.",
    };
  }

  let companyId: string | null = null;
  if (p.companyName?.trim()) {
    companyId = await resolveOrCreateCompanyId(p.companyName.trim(), logs);
  }

  const existingId = await findPersonIdByLinkedInHint(
    linkedinId,
    p.linkedinUrl?.trim() || null,
    logs
  );

  const firstFromParse = (p.firstName && p.firstName.trim()) || "";
  if (!existingId && !firstFromParse) {
    return {
      error:
        "Could not determine a first name. Add a Name: line, a full name, or a LinkedIn URL with Unipile configured.",
    };
  }

  let personId: string;

  if (existingId) {
    personId = existingId;
  } else {
    const last = (p.lastName && p.lastName.trim()) || "";
    const nextLi = (p.linkedinUrl && p.linkedinUrl.trim()) || "";
    const nextTitle = (p.jobTitle && p.jobTitle.trim()) || "";
    const ins = await query<{ id: string }>(
      `INSERT INTO person ("nameFirstName", "nameLastName", "jobTitle", "linkedinLinkPrimaryLinkUrl", "companyId", "createdAt", "updatedAt")
       VALUES ($1, $2, NULLIF(TRIM($3), ''), NULLIF(TRIM($4), ''), $5, NOW(), NOW())
       RETURNING id`,
      [firstFromParse, last || null, nextTitle, nextLi, companyId]
    );
    const newId = ins[0]?.id;
    if (!newId) return { error: "Failed to create CRM person." };
    personId = newId;
    logs.push(logTs(`Warm discovery: created person ${personId.slice(0, 8)}…`));
  }

  const linked = await query<{ id: string }>(
    `UPDATE "_workflow_item"
     SET "sourceType" = 'person', "sourceId" = $1, "updatedAt" = NOW()
     WHERE id = $2 AND "sourceType" = $3 AND "deletedAt" IS NULL
     RETURNING id`,
    [personId, workflowItemId, WARM_DISCOVERY_SOURCE_TYPE]
  );
  if (linked.length === 0) {
    if (!existingId) {
      await query(`UPDATE person SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`, [
        personId,
      ]);
    }
    return { error: "Could not link this workflow row to the contact (it may have already been linked)." };
  }

  await applyWarmContactIntakeToPerson(personId, notes, logs);
  return { personId };
}

/**
 * Updates the placeholder (or existing) person linked to a warm-outreach item
 * when Govind submits AWAITING_CONTACT notes.
 */
/**
 * Warm-outreach RESEARCHING: apply Unipile LinkedIn profile JSON to the linked CRM person.
 * Prefers LinkedIn fields when present; clears discovery placeholder job title when replacing.
 */
export async function applyUnipileResearchToPerson(
  personId: string,
  rawUnipile: unknown,
  logs: string[]
): Promise<boolean> {
  const u = extractUnipileProfileCrmFields(rawUnipile);
  if (!u) {
    logs.push(logTs("Warm RESEARCHING: Unipile response had no usable CRM fields — person row unchanged"));
    return false;
  }

  const rows = await query<{
    nameFirstName: string | null;
    nameLastName: string | null;
    jobTitle: string | null;
    linkedinLinkPrimaryLinkUrl: string | null;
    companyId: string | null;
  }>(
    `SELECT "nameFirstName", "nameLastName", "jobTitle", "linkedinLinkPrimaryLinkUrl", "companyId"
     FROM person WHERE id = $1 AND "deletedAt" IS NULL`,
    [personId]
  );
  if (rows.length === 0) {
    logs.push(logTs("Warm RESEARCHING: person row not found"));
    return false;
  }

  const cur = rows[0];
  const nextFirst = u.firstName.trim() || (cur.nameFirstName || "").trim();
  const nextLast = (u.lastName || "").trim() || (cur.nameLastName || "").trim() || "";

  let nextTitle: string;
  if ((u.jobTitle || "").trim()) {
    nextTitle = (u.jobTitle || "").trim();
  } else if (
    isWarmOutreachPlaceholderJobTitle(cur.jobTitle) ||
    isLinkedInInboundAutoJobTitle(cur.jobTitle)
  ) {
    nextTitle = "";
  } else {
    nextTitle = (cur.jobTitle || "").trim();
  }

  const nextLi = (u.profileUrl || "").trim() || (cur.linkedinLinkPrimaryLinkUrl || "").trim();
  const nextProviderId = extractUnipileProviderIdFromProfile(rawUnipile);

  let companyId: string | null = cur.companyId ?? null;
  if (u.companyName?.trim()) {
    const cid = await resolveOrCreateCompanyId(u.companyName.trim(), logs);
    if (cid) companyId = cid;
  }

  if (!nextFirst) {
    logs.push(logTs("Warm RESEARCHING: skip UPDATE — no first name from LinkedIn or CRM"));
    return false;
  }

  const msgOk = (extra: string) =>
    logTs(
      `Warm RESEARCHING: updated person ${personId.slice(0, 8)}… name="${nextFirst} ${nextLast}" title=${nextTitle ? "set" : "cleared"} companyLinked=${companyId ? "yes" : "no"}${extra}`
    );

  if (nextProviderId) {
    try {
      await query(
        `UPDATE person SET
           "nameFirstName" = $1,
           "nameLastName" = $2,
           "jobTitle" = NULLIF(TRIM($3), ''),
           "linkedinLinkPrimaryLinkUrl" = NULLIF(TRIM($4), ''),
           "linkedinProviderId" = NULLIF(TRIM($6), ''),
           "companyId" = $5,
           "updatedAt" = NOW()
         WHERE id = $7 AND "deletedAt" IS NULL`,
        [nextFirst, nextLast, nextTitle, nextLi, companyId, nextProviderId, personId]
      );
      logs.push(msgOk(` linkedinProviderId=${nextProviderId.slice(0, 12)}…`));
      return true;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (!m.includes("linkedinProviderId")) throw e;
      logs.push(logTs("Warm RESEARCHING: linkedinProviderId column missing — run migrate-person-linkedin-provider.sql"));
    }
  }

  await query(
    `UPDATE person SET
       "nameFirstName" = $1,
       "nameLastName" = $2,
       "jobTitle" = NULLIF(TRIM($3), ''),
       "linkedinLinkPrimaryLinkUrl" = NULLIF(TRIM($4), ''),
       "companyId" = $5,
       "updatedAt" = NOW()
     WHERE id = $6 AND "deletedAt" IS NULL`,
    [nextFirst, nextLast, nextTitle, nextLi, companyId, personId]
  );

  logs.push(msgOk(""));
  return true;
}

export async function applyWarmContactIntakeToPerson(
  personId: string,
  notes: string,
  logs: string[]
): Promise<boolean> {
  const rows = await query<{
    nameFirstName: string | null;
    nameLastName: string | null;
    jobTitle: string | null;
    linkedinLinkPrimaryLinkUrl: string | null;
    companyId: string | null;
  }>(
    `SELECT "nameFirstName", "nameLastName", "jobTitle", "linkedinLinkPrimaryLinkUrl", "companyId"
     FROM person WHERE id = $1 AND "deletedAt" IS NULL`,
    [personId]
  );
  if (rows.length === 0) {
    logs.push(logTs("Warm contact intake: person not found — skip update"));
    return false;
  }

  const cur = rows[0];
  const wasPlaceholder =
    cur.nameFirstName?.trim() === "Next" && cur.nameLastName?.trim() === "Contact";

  let p = parseWarmContactIntake(notes);
  if (wasPlaceholder) {
    p = ensureIntakeNameFromRawLines(notes, p);
  }

  const linkedinId =
    extractLinkedInProfileIdentifier(notes.trim()) ||
    (p.linkedinUrl?.trim() ? extractLinkedInProfileIdentifier(p.linkedinUrl.trim()) : null);

  if (wasPlaceholder && linkedinId && isUnipileConfigured()) {
    const raw = await fetchUnipileLinkedInProfile(linkedinId);
    const u = extractUnipileProfileCrmFields(raw);
    if (u) {
      if (!p.firstName?.trim()) p = { ...p, firstName: u.firstName };
      if (!p.lastName?.trim() && u.lastName) p = { ...p, lastName: u.lastName };
      if (!p.jobTitle?.trim() && u.jobTitle) p = { ...p, jobTitle: u.jobTitle };
      if (!p.companyName?.trim() && u.companyName) p = { ...p, companyName: u.companyName };
      if (!p.linkedinUrl?.trim() && u.profileUrl) p = { ...p, linkedinUrl: u.profileUrl };
      logs.push(
        logTs(
          `Warm contact intake: merged Unipile profile (${linkedinId.length > 56 ? `${linkedinId.slice(0, 56)}…` : linkedinId})`
        )
      );
    } else {
      logs.push(
        logTs(
          "Warm contact intake: Unipile returned no usable name — check identifier, account session, and API response"
        )
      );
    }
  } else if (wasPlaceholder && linkedinId && !isUnipileConfigured()) {
    logs.push(
      logTs(
        "Warm contact intake: LinkedIn id/URL in notes but Unipile env missing — set UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_ACCOUNT_ID to load name from profile"
      )
    );
  }

  const hasAny =
    (p.firstName && p.firstName.trim()) ||
    (p.lastName && p.lastName.trim()) ||
    (p.jobTitle && p.jobTitle.trim()) ||
    (p.companyName && p.companyName.trim()) ||
    (p.linkedinUrl && p.linkedinUrl.trim());

  if (!hasAny) {
    logs.push(logTs("Warm contact intake: parsed no name/title/company/LinkedIn — person row unchanged"));
    return false;
  }

  let companyId: string | null = null;
  if (p.companyName?.trim()) {
    companyId = await resolveOrCreateCompanyId(p.companyName.trim(), logs);
  }

  const nextFirst =
    p.firstName != null && p.firstName.trim() !== ""
      ? p.firstName.trim()
      : (cur.nameFirstName ?? "");
  const nextLast =
    p.lastName != null && p.lastName.trim() !== ""
      ? p.lastName.trim()
      : (cur.nameLastName ?? "");
  const nextTitle =
    p.jobTitle != null && p.jobTitle.trim() !== "" ? p.jobTitle.trim() : (cur.jobTitle ?? "");
  const nextLi =
    p.linkedinUrl != null && p.linkedinUrl.trim() !== ""
      ? p.linkedinUrl.trim()
      : (cur.linkedinLinkPrimaryLinkUrl ?? "");
  const nextCo = companyId ?? cur.companyId ?? null;

  const nameFirst =
    nextFirst.trim() || (cur.nameFirstName?.trim() ? cur.nameFirstName.trim() : "Contact");
  const nameLast = nextLast.trim();

  if (wasPlaceholder && nameFirst.trim() === "Next" && nameLast.trim() === "Contact") {
    const hint =
      linkedinId && !isUnipileConfigured()
        ? "LinkedIn URL/id found but Unipile is not configured — set UNIPILE_* env vars."
        : linkedinId
          ? "LinkedIn URL did not yield a name from Unipile — verify the profile URL and API access."
          : "Add a LinkedIn profile URL, Name: line, or full name on its own line in intake notes.";
    logs.push(logTs(`Warm contact intake: CRM placeholder unchanged — ${hint}`));
    return false;
  }

  const updated = await query<{ id: string }>(
    `UPDATE person SET
       "nameFirstName" = $1,
       "nameLastName" = $2,
       "jobTitle" = NULLIF(TRIM($3), ''),
       "linkedinLinkPrimaryLinkUrl" = NULLIF(TRIM($4), ''),
       "companyId" = $5,
       "updatedAt" = NOW()
     WHERE id = $6 AND "deletedAt" IS NULL
     RETURNING id`,
    [nameFirst, nameLast, nextTitle, nextLi, nextCo, personId]
  );

  if (updated.length === 0) {
    logs.push(logTs("Warm contact intake: UPDATE returned no row (id mismatch or deleted?)"));
    return false;
  }

  logs.push(
    logTs(
      `Warm contact intake: updated person ${personId.slice(0, 8)}… name="${nameFirst} ${nameLast}" companyLinked=${nextCo ? "yes" : "no"}`
    )
  );
  return true;
}

/** Intake notes saved as AWAITING_CONTACT stage and/or "Human input: …" artifact names. */
const ARTIFACT_INTAKE_FILTER = `(
         UPPER(TRIM(stage::text)) = 'AWAITING_CONTACT'
         OR COALESCE(name, '') ILIKE '%AWAITING_CONTACT%'
         OR (
           COALESCE(name, '') ILIKE '%Human input%'
           AND COALESCE(name, '') NOT ILIKE '%Human approve%'
         )
       )`;

/**
 * Walk intake-related artifacts oldest → newest and apply the first that parses
 * (fixes resolve skipping DB update when stage was no longer AWAITING_CONTACT).
 */
export async function syncWarmPersonFromIntakeArtifacts(
  workflowItemId: string,
  personId: string,
  logs: string[]
): Promise<boolean> {
  const pr = await query<{ tf: string; tl: string }>(
    `SELECT TRIM(COALESCE("nameFirstName",'')) AS tf, TRIM(COALESCE("nameLastName",'')) AS tl
     FROM person WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1`,
    [personId]
  );
  const isPlaceholder = pr[0]?.tf === "Next" && pr[0]?.tl === "Contact";
  if (!isPlaceholder) {
    logs.push(logTs("Warm sync: person is not Next/Contact placeholder — skip"));
    return false;
  }

  let rows = await query<{ content: string }>(
    `SELECT content FROM "_artifact"
     WHERE "workflowItemId" = $1 AND "deletedAt" IS NULL
       AND TRIM(COALESCE(content, '')) <> ''
       AND ${ARTIFACT_INTAKE_FILTER}
     ORDER BY "createdAt" ASC`,
    [workflowItemId]
  );

  if (rows.length === 0) {
    logs.push(
      logTs(
        "Warm sync: no intake-tagged artifacts — trying other markdown bodies on this item (chronological)"
      )
    );
    rows = await query<{ content: string }>(
      `SELECT content FROM "_artifact"
       WHERE "workflowItemId" = $1 AND "deletedAt" IS NULL
         AND LENGTH(TRIM(COALESCE(content, ''))) BETWEEN 12 AND 25000
       ORDER BY "createdAt" ASC
       LIMIT 40`,
      [workflowItemId]
    );
  }

  for (const r of rows) {
    const ok = await applyWarmContactIntakeToPerson(personId, r.content.trim(), logs);
    if (ok) return true;
  }
  return false;
}

/**
 * For `warm_discovery` rows: walk intake artifacts and link/create `person` on first successful parse.
 */
export async function syncWarmDiscoveryFromIntakeArtifacts(
  workflowItemId: string,
  logs: string[]
): Promise<boolean> {
  const meta = await query<{ sourceType: string; stage: string }>(
    `SELECT "sourceType", stage FROM "_workflow_item" WHERE id = $1 AND "deletedAt" IS NULL`,
    [workflowItemId]
  );
  if (meta[0]?.sourceType !== WARM_DISCOVERY_SOURCE_TYPE) {
    logs.push(logTs("Warm discovery sync: item is not a warm_discovery slot — skip"));
    return false;
  }
  const st = (meta[0]?.stage || "").trim().toUpperCase();
  if (st !== "AWAITING_CONTACT") {
    logs.push(logTs("Warm discovery sync: not at AWAITING_CONTACT — skip"));
    return false;
  }

  let rows = await query<{ content: string }>(
    `SELECT content FROM "_artifact"
     WHERE "workflowItemId" = $1 AND "deletedAt" IS NULL
       AND TRIM(COALESCE(content, '')) <> ''
       AND ${ARTIFACT_INTAKE_FILTER}
     ORDER BY "createdAt" ASC`,
    [workflowItemId]
  );

  if (rows.length === 0) {
    logs.push(
      logTs(
        "Warm discovery sync: no intake-tagged artifacts — trying other markdown bodies (chronological)"
      )
    );
    rows = await query<{ content: string }>(
      `SELECT content FROM "_artifact"
       WHERE "workflowItemId" = $1 AND "deletedAt" IS NULL
         AND LENGTH(TRIM(COALESCE(content, ''))) BETWEEN 12 AND 25000
       ORDER BY "createdAt" ASC
       LIMIT 40`,
      [workflowItemId]
    );
  }

  for (const r of rows) {
    const res = await createOrLinkPersonForWarmDiscoveryItem(workflowItemId, r.content.trim(), logs);
    if ("personId" in res) return true;
  }
  return false;
}

/**
 * Any recent artifact on this item that contains a linkedin.com/in URL (intake, research, draft bodies).
 * Used when `person.linkedinLinkPrimaryLinkUrl` is empty but the thread was set up from notes.
 */
export async function getLatestLinkedInUrlFromWorkflowArtifacts(
  workflowItemId: string
): Promise<string | null> {
  const rows = await query<{ content: string }>(
    `SELECT content FROM "_artifact"
     WHERE "workflowItemId" = $1 AND "deletedAt" IS NULL
       AND content ~* 'linkedin\\.com/in/[[:alnum:]_.-]+'
     ORDER BY "createdAt" DESC
     LIMIT 8`,
    [workflowItemId]
  );
  for (const r of rows) {
    const u = extractLinkedInUrlFromText(r.content || "");
    if (u) return u;
  }
  return null;
}

/** Latest human intake text for Tim header overlay (prefers newest matching artifact). */
export async function getLatestAwaitingContactArtifactContent(
  workflowItemId: string
): Promise<string | null> {
  const rows = await query<{ content: string }>(
    `SELECT content FROM "_artifact"
     WHERE "workflowItemId" = $1
       AND "deletedAt" IS NULL
       AND TRIM(COALESCE(content, '')) <> ''
       AND ${ARTIFACT_INTAKE_FILTER}
     ORDER BY "createdAt" DESC LIMIT 1`,
    [workflowItemId]
  );
  const text = rows[0]?.content?.trim();
  return text || null;
}

/** One query for many items — used by GET /api/crm/human-tasks (avoid N+1). */
export async function batchGetLatestAwaitingContactArtifactContentByItemIds(
  workflowItemIds: string[]
): Promise<Map<string, string>> {
  const uniq = [...new Set(workflowItemIds.filter(Boolean))];
  const out = new Map<string, string>();
  if (uniq.length === 0) return out;
  const rows = await query<{ workflowItemId: string; content: string }>(
    `SELECT DISTINCT ON ("workflowItemId") "workflowItemId", content
     FROM "_artifact"
     WHERE "workflowItemId" = ANY($1::uuid[])
       AND "deletedAt" IS NULL
       AND TRIM(COALESCE(content, '')) <> ''
       AND ${ARTIFACT_INTAKE_FILTER}
     ORDER BY "workflowItemId", "createdAt" DESC`,
    [uniq]
  );
  for (const r of rows) {
    const t = r.content?.trim();
    if (t) out.set(r.workflowItemId, t);
  }
  return out;
}

/** Latest artifact per item that contains a linkedin.com/in URL (same idea as getLatestLinkedInUrlFromWorkflowArtifacts). */
export async function batchGetLatestLinkedInArtifactUrlByItemIds(
  workflowItemIds: string[]
): Promise<Map<string, string>> {
  const uniq = [...new Set(workflowItemIds.filter(Boolean))];
  const out = new Map<string, string>();
  if (uniq.length === 0) return out;
  const rows = await query<{ workflowItemId: string; content: string }>(
    `SELECT DISTINCT ON ("workflowItemId") "workflowItemId", content
     FROM "_artifact"
     WHERE "workflowItemId" = ANY($1::uuid[])
       AND "deletedAt" IS NULL
       AND content ~* 'linkedin\\.com/in/[[:alnum:]_.-]+'
     ORDER BY "workflowItemId", "createdAt" DESC`,
    [uniq]
  );
  for (const r of rows) {
    const u = extractLinkedInUrlFromText(r.content || "");
    if (u) out.set(r.workflowItemId, u);
  }
  return out;
}

/**
 * If the workflow item still points at the discovery placeholder person but an
 * intake artifact exists, apply parsed fields to `person` (CRM row).
 */
export async function tryHealWarmPersonFromAwaitingArtifact(
  workflowItemId: string,
  personId: string,
  logs: string[]
): Promise<boolean> {
  return syncWarmPersonFromIntakeArtifacts(workflowItemId, personId, logs);
}
