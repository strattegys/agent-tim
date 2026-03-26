/**
 * LinkedIn profile retrieval via Unipile REST API (same contract as scripts/linkedin_unipile.sh).
 * Used for warm-outreach RESEARCHING enrichment in the CRM app — no bash / linkedin.sh required.
 */

/** Host:port only — strips `https://` and path if someone pastes a full URL. */
export function normalizeUnipileDsn(raw: string | undefined | null): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/^https?:\/\//i, "");
  s = s.split("/")[0]?.trim() ?? "";
  return s;
}

export function isUnipileConfigured(): boolean {
  return Boolean(
    process.env.UNIPILE_API_KEY?.trim() &&
      normalizeUnipileDsn(process.env.UNIPILE_DSN) &&
      process.env.UNIPILE_ACCOUNT_ID?.trim()
  );
}

/** Extract public slug or ACoAAA provider id from text or URL. */
export function extractLinkedInProfileIdentifier(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  const fromUrl = t.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (fromUrl) {
    try {
      return decodeURIComponent(fromUrl[1]);
    } catch {
      return fromUrl[1];
    }
  }
  if (/^ACoA[A-Za-z0-9_-]+/i.test(t)) return t;
  if (/^[a-z0-9\-_%]{2,200}$/i.test(t)) return t;
  return null;
}

export async function fetchUnipileLinkedInProfile(
  identifier: string
): Promise<unknown | null> {
  const key = process.env.UNIPILE_API_KEY;
  const dsn = normalizeUnipileDsn(process.env.UNIPILE_DSN);
  const accountId = process.env.UNIPILE_ACCOUNT_ID;
  if (!key?.trim() || !dsn || !accountId?.trim()) {
    return null;
  }

  const base = `https://${dsn}/api/v1`;
  const url = `${base}/users/${encodeURIComponent(identifier)}?account_id=${encodeURIComponent(accountId)}&linkedin_sections=*`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-KEY": key,
        accept: "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      console.error("[unipile-profile] Non-JSON response", res.status, text.slice(0, 200));
      return { httpStatus: res.status, raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      console.error("[unipile-profile] API error", res.status, data);
      return data;
    }
    return data;
  } catch (e) {
    console.error("[unipile-profile] fetch failed:", e);
    return null;
  }
}

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function pickNum(v: unknown): number | undefined {
  return typeof v === "number" && !Number.isNaN(v) ? v : undefined;
}

/** Fields we can write to CRM `person` from a successful Unipile user profile fetch. */
export type UnipileProfileCrmFields = {
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  companyName: string | null;
  profileUrl: string | null;
};

/**
 * Map Unipile `GET /users/{identifier}` JSON → CRM person columns (warm-outreach intake).
 */
export function extractUnipileProfileCrmFields(data: unknown): UnipileProfileCrmFields | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (typeof o.httpStatus === "number" && o.httpStatus >= 400) return null;
  if (o.error != null || o.detail != null) return null;

  let firstName = pickStr(o.first_name) ?? "";
  let lastName = pickStr(o.last_name) ?? "";
  const compound = pickStr(o.name);
  if (!firstName && compound) {
    const parts = compound.split(/\s+/).filter(Boolean);
    firstName = parts[0] ?? "";
    lastName = parts.slice(1).join(" ") || "";
  }
  if (!firstName.trim()) return null;

  const headline = pickStr(o.headline) ?? null;
  let jobTitle: string | null = headline;
  let companyName: string | null = null;
  const work = o.work_experience;
  if (Array.isArray(work) && work.length > 0 && work[0] && typeof work[0] === "object") {
    const w0 = work[0] as Record<string, unknown>;
    const pos = pickStr(w0.position || w0.title);
    const co = pickStr(w0.company);
    if (co) companyName = co;
    if (pos && !jobTitle) jobTitle = pos;
  }

  const pub = pickStr(o.public_identifier);
  const profileUrl = pub ? `https://www.linkedin.com/in/${pub}` : null;

  return {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    jobTitle: jobTitle?.trim() || null,
    companyName,
    profileUrl,
  };
}

/** Turn Unipile UserProfile JSON into markdown for artifacts + LLM context. */
export function formatUnipileProfileMarkdown(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "_No profile data._";
  }
  const o = data as Record<string, unknown>;
  if (o.error || o.detail || o.message) {
    return `_Unipile returned an error:_\n\n\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 2000)}\n\`\`\``;
  }

  const lines: string[] = [];
  const name = [pickStr(o.first_name), pickStr(o.last_name)].filter(Boolean).join(" ");
  if (name) lines.push(`**Name:** ${name}`);
  const headline = pickStr(o.headline);
  if (headline) lines.push(`**Headline:** ${headline}`);
  const loc = pickStr(o.location);
  if (loc) lines.push(`**Location:** ${loc}`);
  const pub = pickStr(o.public_identifier);
  if (pub) lines.push(`**Public ID:** ${pub}`);
  const pid = pickStr(o.provider_id);
  if (pid) lines.push(`**Provider ID:** ${pid}`);
  const conn = pickNum(o.connections_count);
  const fol = pickNum(o.follower_count);
  if (conn != null) lines.push(`**Connections:** ${conn}`);
  if (fol != null) lines.push(`**Followers:** ${fol}`);

  const summary = pickStr(o.summary);
  if (summary) lines.push(`\n### About\n${summary}`);

  const work = o.work_experience;
  if (Array.isArray(work) && work.length > 0) {
    lines.push("\n### Experience");
    for (const w of work.slice(0, 6)) {
      if (!w || typeof w !== "object") continue;
      const we = w as Record<string, unknown>;
      const parts = [
        pickStr(we.position || we.title),
        pickStr(we.company),
        pickStr(we.date_range || we.date),
      ].filter(Boolean);
      if (parts.length) lines.push(`- ${parts.join(" — ")}`);
    }
  }

  const edu = o.education;
  if (Array.isArray(edu) && edu.length > 0) {
    lines.push("\n### Education");
    for (const e of edu.slice(0, 4)) {
      if (!e || typeof e !== "object") continue;
      const ed = e as Record<string, unknown>;
      const parts = [pickStr(ed.school), pickStr(ed.degree), pickStr(ed.date_range)].filter(Boolean);
      if (parts.length) lines.push(`- ${parts.join(" — ")}`);
    }
  }

  const skills = o.skills;
  if (Array.isArray(skills) && skills.length > 0) {
    const names = skills
      .slice(0, 15)
      .map((s) => {
        if (typeof s === "string") return s;
        if (s && typeof s === "object" && "name" in s) return pickStr((s as { name?: string }).name);
        return undefined;
      })
      .filter(Boolean);
    if (names.length) lines.push(`\n### Skills\n${names.join(", ")}`);
  }

  if (lines.length === 0) {
    return `_Profile object received but no familiar fields parsed._\n\n\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 3500)}\n\`\`\``;
  }

  return lines.join("\n");
}
