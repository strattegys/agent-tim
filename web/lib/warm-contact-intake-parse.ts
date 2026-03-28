/**
 * Best-effort parse of Govind's free-text warm-outreach contact intake
 * (AWAITING_CONTACT → human "input") so we can update the CRM person row.
 */

export type ParsedWarmContactIntake = {
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  companyName: string | null;
  linkedinUrl: string | null;
};

function cleanVal(s: string): string {
  return s.replace(/\s+/g, " ").replace(/^[•\-\*]\s+/, "").trim();
}

function splitFullName(full: string): { first: string; last: string } {
  const t = cleanVal(full);
  if (!t) return { first: "", last: "" };
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/** LinkedIn profile or company URL — strip trailing punctuation. */
export function extractLinkedInUrlFromText(text: string): string | null {
  const m = text.match(/(https?:\/\/)?(www\.)?linkedin\.com\/[^\s\])"'<>]+/i);
  if (!m) return null;
  return m[0].replace(/[.,;:)]+$/, "").trim() || null;
}

/**
 * Lines like `Name: …`, `**Company:** …`, optional markdown bullets.
 * Falls back to first substantive line as full name if no Name label.
 */
export function parseWarmContactIntake(raw: string): ParsedWarmContactIntake {
  let linkedinUrl = extractLinkedInUrlFromText(raw);

  let nameFromLabel: string | null = null;
  let jobTitle: string | null = null;
  let companyName: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(
      /^\s*(?:[-*•]\s*)?(?:\*\*)?([^*:]+?)(?:\*\*)?\s*:\s*(.+)$/
    );
    if (!m) continue;
    const key = m[1].toLowerCase().replace(/\*/g, "").trim();
    const val = cleanVal(m[2]);
    if (!val) continue;

    if (key === "name" || key === "full name" || key === "contact") {
      nameFromLabel = val;
    } else if (
      key === "company" ||
      key === "co" ||
      key === "co." ||
      key === "organization" ||
      key === "organisation" ||
      key === "employer" ||
      key === "org"
    ) {
      companyName = val;
    } else if (
      key === "title" ||
      key === "role" ||
      key === "job title" ||
      key === "job" ||
      key === "position"
    ) {
      jobTitle = val;
    } else if (
      key === "linkedin" ||
      key === "linked in" ||
      key === "linkedin url" ||
      key === "linkedin profile" ||
      key === "li url" ||
      key === "profile url" ||
      key === "profile"
    ) {
      const fromLabel =
        extractLinkedInUrlFromText(val) || (/^https?:\/\//i.test(val) ? val.split(/\s/)[0] : null);
      if (fromLabel) linkedinUrl = fromLabel;
    }
  }

  // "Title at Company" / "VP @ Sorint"
  if (jobTitle && !companyName) {
    const atCo = jobTitle.match(/\s+(?:at|@)\s+(.+)$/i);
    if (atCo && atCo.index != null) {
      companyName = cleanVal(atCo[1]);
      jobTitle = cleanVal(jobTitle.slice(0, atCo.index));
    }
  }

  let firstName: string | null = null;
  let lastName: string | null = null;

  if (nameFromLabel) {
    const sp = splitFullName(nameFromLabel);
    firstName = sp.first || null;
    lastName = sp.last || null;
  } else {
    for (const line of raw.split(/\r?\n/)) {
      const t = cleanVal(line);
      if (!t || t.length > 120) continue;
      if (/linkedin\.com/i.test(t)) continue;
      if (/^\s*(?:[-*•]\s*)?(?:\*\*)?[^*:]+(?:\*\*)?\s*:/.test(line)) continue;
      if (/^(name|company|title|role)\b/i.test(t)) continue;
      const sp = splitFullName(t);
      if (sp.first && /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.-]*$/.test(t)) {
        firstName = sp.first || null;
        lastName = sp.last || null;
        break;
      }
    }
  }

  // Comma form: "Corrado Bavere, Sorint" or "Bavere, Corrado, Sorint" (avoid if already set)
  if ((!firstName || !companyName) && !nameFromLabel) {
    const oneLine = cleanVal(raw.replace(/\r?\n/g, " "));
    const commaParts = oneLine.split(",").map((s) => s.trim()).filter(Boolean);
    if (commaParts.length >= 2 && commaParts.length <= 4 && !/linkedin\.com/i.test(oneLine)) {
      const a = commaParts[0];
      const b = commaParts[1];
      const spA = splitFullName(a);
      if (spA.first && /^[A-Za-zÀ-ÿ]/.test(a) && b.length < 80 && !/https?:\/\//i.test(b)) {
        if (!firstName) firstName = spA.first;
        if (!lastName) lastName = spA.last || null;
        if (!companyName) companyName = b;
        if (!jobTitle && commaParts.length >= 3 && commaParts[2].length < 120) {
          jobTitle = commaParts[2];
        }
      }
    }
  }

  // Unlabeled blocks: "Full Name\nCompany\nTitle" (works with or without a Name: line above)
  const nonemptyLines = raw
    .split(/\r?\n/)
    .map((l) => cleanVal(l))
    .filter(Boolean);
  if (nonemptyLines.length >= 2) {
    const L0 = nonemptyLines[0];
    const L1 = nonemptyLines[1];
    if (!/linkedin\.com/i.test(L0) && !/linkedin\.com/i.test(L1)) {
      const sp0 = splitFullName(L0);
      const l0LooksLikePerson =
        sp0.first &&
        L0.split(/\s+/).length <= 6 &&
        /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.-]*$/.test(L0);
      const l1ShortOrg = L1.length > 0 && L1.length < 100;
      if (l0LooksLikePerson && l1ShortOrg) {
        if (!firstName) firstName = sp0.first;
        if (!lastName) lastName = sp0.last || null;
        if (!companyName) companyName = L1;
      }
    }
  }
  if (nonemptyLines.length >= 3 && !jobTitle) {
    const L2 = nonemptyLines[2];
    if (
      L2.length > 0 &&
      L2.length < 100 &&
      !/linkedin\.com/i.test(L2) &&
      !/^\s*(?:[-*•]\s*)?(?:\*\*)?[\w\s]+(?:\*\*)?\s*:/.test(L2)
    ) {
      jobTitle = L2;
    }
  }

  return { firstName, lastName, jobTitle, companyName, linkedinUrl };
}

/**
 * If parse missed a person name, infer from the first plausible free-text line (sync / CRM placeholder).
 */
export function ensureIntakeNameFromRawLines(
  raw: string,
  parsed: ParsedWarmContactIntake
): ParsedWarmContactIntake {
  if (
    (parsed.firstName && parsed.firstName.trim()) ||
    (parsed.lastName && parsed.lastName.trim())
  ) {
    return parsed;
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = cleanVal(line);
    if (!t || t.length > 140) continue;
    if (/linkedin\.com/i.test(t)) continue;
    if (/^\s*#+\s/.test(line)) continue;
    if (/^\s*[-*•]\s+\*\*[^*]+\*\*\s*:/.test(line)) continue;
    if (/^[A-Za-z0-9][\w\s]{0,40}:\s*.+/i.test(t) && !/^full\s*name\s*:/i.test(t)) continue;
    const sp = splitFullName(t);
    if (!sp.first) continue;
    if (!/^[A-Za-zÀ-ÿ]/.test(t.charAt(0))) continue;
    return {
      ...parsed,
      firstName: sp.first,
      lastName: sp.last || null,
    };
  }
  return parsed;
}
