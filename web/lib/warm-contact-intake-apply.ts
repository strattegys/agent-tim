import { query } from "@/lib/db";
import { ensureIntakeNameFromRawLines, parseWarmContactIntake } from "@/lib/warm-contact-intake-parse";
import {
  extractLinkedInProfileIdentifier,
  extractUnipileProfileCrmFields,
  fetchUnipileLinkedInProfile,
  isUnipileConfigured,
} from "@/lib/unipile-profile";

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

/**
 * Updates the placeholder (or existing) person linked to a warm-outreach item
 * when Govind submits AWAITING_CONTACT notes.
 */
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
