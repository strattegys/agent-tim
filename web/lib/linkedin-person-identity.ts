/**
 * CRM person ↔ LinkedIn / Unipile identity.
 * Twenty stores `linkedinLinkPrimaryLinkUrl`; optional `linkedinProviderId` holds Unipile member id (ACoA…).
 */
import { extractLinkedInProfileIdentifier } from "@/lib/unipile-profile";

/**
 * SQL fragment: best-effort LinkedIn URL from flat `linkedinLinkPrimaryLinkUrl` plus optional jsonb `linkedinUrl`.
 * Use in SELECT/WHERE; fall back to flat-only SQL if the DB rejects jsonb access.
 */
export function sqlPersonLinkedinUrlCoalesce(alias = "p"): string {
  return `COALESCE(
    NULLIF(TRIM(${alias}."linkedinLinkPrimaryLinkUrl"), ''),
    NULLIF(TRIM(${alias}."linkedinUrl"->>'value'), ''),
    NULLIF(TRIM(${alias}."linkedinUrl"->>'primaryLinkUrl'), ''),
    NULLIF(TRIM(${alias}."linkedinUrl"->'primaryLinkUrl'->>'value'), '')
  )`;
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when jsonb `linkedinUrl` extract is invalid or the column is missing. */
export function linkedinUrlJsonCoalesceUnsupported(error: unknown): boolean {
  const m = errMsg(error);
  if (/linkedinUrl/i.test(m) && /does not exist/i.test(m)) return true;
  return /operator does not exist/i.test(m) && (/->>|#>>/i.test(m) || /jsonb/i.test(m));
}

/** Postgres missing-column style errors for `columnName`. */
export function postgresMissingColumn(error: unknown, columnName: string): boolean {
  let code: string | undefined;
  if (error && typeof error === "object" && "code" in error) {
    code = String((error as { code: unknown }).code);
  }
  const re = new RegExp(columnName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const m = errMsg(error);
  if (code === "42703" && re.test(m)) return true;
  return re.test(m) && (/column/i.test(m) || /field/i.test(m)) && /does not exist/i.test(m);
}

const ACOA = /^ACoA[A-Za-z0-9_-]+$/i;

/** True if this string is a Unipile/LinkedIn API member id (not a vanity slug). */
export function isLinkedInProviderMemberId(s: string): boolean {
  return ACOA.test(s.trim());
}

export type ParsedPersonLinkedIn = {
  /** Normalized https://… linkedin.com/in/… when the field is a public URL */
  publicProfileUrl: string | null;
  /** Unipile `provider_id` / member id when known */
  providerMemberId: string | null;
};

/**
 * Derive display + API hints from `person.linkedinLinkPrimaryLinkUrl` and optional `linkedinProviderId`.
 */
export function parsePersonLinkedInFields(
  linkedinLinkPrimaryLinkUrl: string | null | undefined,
  linkedinProviderId: string | null | undefined
): ParsedPersonLinkedIn {
  const urlRaw = (linkedinLinkPrimaryLinkUrl || "").trim();
  const colPid = (linkedinProviderId || "").trim();

  let providerMemberId = colPid && isLinkedInProviderMemberId(colPid) ? colPid : null;
  let publicProfileUrl: string | null = null;

  if (urlRaw) {
    if (isLinkedInProviderMemberId(urlRaw)) {
      if (!providerMemberId) providerMemberId = urlRaw;
    } else {
      const id = extractLinkedInProfileIdentifier(urlRaw);
      if (id && !isLinkedInProviderMemberId(id)) {
        publicProfileUrl = `https://www.linkedin.com/in/${id}`;
      } else if (id && isLinkedInProviderMemberId(id) && !providerMemberId) {
        providerMemberId = id;
      } else if (/^https?:\/\//i.test(urlRaw)) {
        publicProfileUrl = urlRaw.split("?")[0];
      }
    }
  }

  return { publicProfileUrl, providerMemberId };
}

/**
 * Pull Unipile member id or public slug/URL from markdown bodies (e.g. LinkedIn inbound artifacts:
 * `**Provider id:** ACoA…`) or free text.
 */
export function extractLinkedInHintFromArtifactOrNotes(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  for (const line of t.split(/\r?\n/)) {
    const prov =
      line.match(/\*\*Provider id:\*\*\s*(\S+)/i)?.[1] ??
      line.match(/^\s*Provider id:\s*(\S+)/i)?.[1];
    if (prov && isLinkedInProviderMemberId(prov)) return prov.trim();
  }
  const ac = t.match(/\b(ACoA[A-Za-z0-9_-]+)\b/i);
  if (ac?.[1] && isLinkedInProviderMemberId(ac[1])) return ac[1];
  return extractLinkedInProfileIdentifier(t);
}

/**
 * Best identifier to pass to Unipile `GET /users/{id}` / send — prefers stable member id when present.
 */
export function resolveUnipilePersonIdentifier(args: {
  linkedinLinkPrimaryLinkUrl: string | null | undefined;
  linkedinProviderId: string | null | undefined;
  notesFallback?: string | null;
}): string | null {
  const parsed = parsePersonLinkedInFields(
    args.linkedinLinkPrimaryLinkUrl,
    args.linkedinProviderId
  );
  if (parsed.providerMemberId) return parsed.providerMemberId;
  const fromUrl = (args.linkedinLinkPrimaryLinkUrl || "").trim();
  const slug = extractLinkedInProfileIdentifier(fromUrl);
  if (slug) return slug;
  if (args.notesFallback) {
    return extractLinkedInHintFromArtifactOrNotes(args.notesFallback);
  }
  return null;
}
