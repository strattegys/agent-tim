/**
 * LinkedIn CRM operations — contact management, enrichment, and stage tracking.
 * Ported from slack/src/linkedin-connections.ts (Slack-free).
 */
import https from "https";
import fs from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { normalizeUnipileDsn } from "./unipile-profile";
import { recordGeneralLinkedInInbound } from "./linkedin-general-inbox";
import { recordUsageEvent } from "./usage-events";

const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY || "";
const UNIPILE_ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || "";

const TOOL_SCRIPTS_PATH = process.env.TOOL_SCRIPTS_PATH || "/root/.nanobot/tools";
const CRM_TOOL = join(TOOL_SCRIPTS_PATH, "crm.sh");
const LINKEDIN_TOOL = join(TOOL_SCRIPTS_PATH, "linkedin.sh");

const PROCESSED_FILE =
  process.env.LINKEDIN_CONNECTIONS_PROCESSED || "/root/.nanobot/linkedin_connections_processed.json";

let cachedCrmShellUsable: boolean | null = null;

/**
 * Twenty/nanobot shell tools (`crm.sh`, `linkedin.sh`) + bash. False in Command Central Docker
 * (node-alpine, no bash, no scripts) — without this guard, cron/webhooks call execFileSync in a tight
 * loop and can stall the Node process so the app stops responding.
 */
export function isLinkedInCrmShellAvailable(): boolean {
  if (cachedCrmShellUsable !== null) return cachedCrmShellUsable;
  if (process.env.LINKEDIN_CRM_USE_SHELL === "0") {
    cachedCrmShellUsable = false;
    return false;
  }
  try {
    if (!fs.existsSync(CRM_TOOL) || !fs.existsSync(LINKEDIN_TOOL)) {
      cachedCrmShellUsable = false;
      return false;
    }
    execFileSync("bash", ["-c", "exit 0"], {
      timeout: 800,
      encoding: "utf-8",
      stdio: "ignore",
    });
    cachedCrmShellUsable = true;
    return true;
  } catch {
    cachedCrmShellUsable = false;
    return false;
  }
}

// ── CRM Operations ──────────────────────────────────────────────────────────

export function searchContacts(
  query: string
): Array<{
  id: string;
  name?: { firstName?: string; lastName?: string };
  linkedinLink?: {
    primaryLinkUrl?: string;
    secondaryLinks?: Array<{ url?: string }>;
  };
}> {
  if (!isLinkedInCrmShellAvailable()) return [];
  try {
    const result = execFileSync("bash", [CRM_TOOL, "search-contacts", query], {
      timeout: 15000,
      encoding: "utf-8",
    });
    const data = JSON.parse(result);
    return data?.data?.people || [];
  } catch {
    return [];
  }
}

export function createContact(
  firstName: string,
  lastName: string,
  linkedinUrl?: string
): string | null {
  if (!isLinkedInCrmShellAvailable()) return null;
  try {
    const payload: Record<string, string> = { firstName, lastName };
    if (linkedinUrl) payload.linkedinUrl = linkedinUrl;
    const result = execFileSync(
      "bash",
      [CRM_TOOL, "create-contact", JSON.stringify(payload)],
      { timeout: 15000, encoding: "utf-8" }
    );
    try {
      const data = JSON.parse(result);
      return data?.id || null;
    } catch {
      return null;
    }
  } catch (err) {
    console.error("[linkedin-crm] Create contact error:", err);
    return null;
  }
}

export function writeNote(
  title: string,
  content: string,
  targetType: string,
  targetId: string
): void {
  if (!isLinkedInCrmShellAvailable()) return;
  try {
    execFileSync(
      "bash",
      [CRM_TOOL, "write-note", title, content, targetType, targetId],
      { timeout: 15000, encoding: "utf-8" }
    );
  } catch (err) {
    console.error("[linkedin-crm] Write note error:", err);
  }
}

/**
 * Find a CRM contact by LinkedIn provider ID, then by name.
 * Creates a new contact if not found.
 */
export function findOrCreateContact(
  senderName: string,
  senderProviderId: string
): string | null {
  if (!isLinkedInCrmShellAvailable()) return null;
  const linkedinUrl = senderProviderId
    ? `https://www.linkedin.com/in/${senderProviderId}`
    : "";

  const nameParts = senderName.split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  if (firstName) {
    const contacts = searchContacts(senderName);
    for (const c of contacts) {
      const primaryUrl = c.linkedinLink?.primaryLinkUrl || "";
      if (senderProviderId && primaryUrl.includes(senderProviderId)) {
        return c.id;
      }
      for (const sec of c.linkedinLink?.secondaryLinks || []) {
        if (senderProviderId && (sec.url || "").includes(senderProviderId)) {
          return c.id;
        }
      }
      const cFirst = (c.name?.firstName || "").toLowerCase();
      const cLast = (c.name?.lastName || "").toLowerCase();
      if (
        cFirst === firstName.toLowerCase() &&
        cLast === lastName.toLowerCase()
      ) {
        return c.id;
      }
    }
  }

  console.log(`[linkedin-crm] Creating new contact: ${senderName}`);
  return createContact(firstName, lastName, linkedinUrl);
}

// ── Stage Management ────────────────────────────────────────────────────────

export function updatePersonStage(contactId: string, stage: string): void {
  if (!isLinkedInCrmShellAvailable()) return;
  try {
    execFileSync(
      "bash",
      [CRM_TOOL, "update-contact", contactId, JSON.stringify({ stage })],
      { timeout: 15000, encoding: "utf-8" }
    );
    console.log(`[linkedin-crm] Set stage=${stage} for contact ${contactId}`);
  } catch (err) {
    console.error(`[linkedin-crm] Stage update error for ${contactId}:`, err);
  }
}

export function getPersonStage(contactId: string): string | null {
  if (!isLinkedInCrmShellAvailable()) return null;
  try {
    const result = execFileSync(
      "bash",
      [CRM_TOOL, "get-contact", contactId],
      { timeout: 15000, encoding: "utf-8" }
    );
    const data = JSON.parse(result);
    return data?.stage || null;
  } catch {
    return null;
  }
}

// ── Profile & Enrichment ────────────────────────────────────────────────────

export function fetchLinkedInProfile(
  identifier: string
): Record<string, unknown> | null {
  if (!isLinkedInCrmShellAvailable()) return null;
  try {
    const result = execFileSync(
      "bash",
      [LINKEDIN_TOOL, "fetch-profile", identifier],
      { timeout: 30000, encoding: "utf-8" }
    );
    return JSON.parse(result);
  } catch (err) {
    console.error(
      `[linkedin-crm] Profile fetch error for ${identifier}:`,
      err
    );
    return null;
  }
}

export function enrichContactFromLinkedIn(
  contactId: string,
  profile: Record<string, unknown>
): void {
  if (!isLinkedInCrmShellAvailable()) return;
  try {
    const workExperience =
      (profile.work_experience as Array<{
        position?: string;
        company?: string;
        end?: string | null;
      }>) || [];
    const currentJob = workExperience.find((w) => !w.end) || workExperience[0];

    const contactInfo = profile.contact_info as
      | { emails?: string[] }
      | undefined;
    const email = contactInfo?.emails?.[0] || "";
    const location = (profile.location as string) || "";
    const jobTitle = currentJob?.position || "";
    const companyName = currentJob?.company || "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update: Record<string, any> = {};
    if (jobTitle) update.jobTitle = jobTitle;
    if (location) update.city = location;
    if (email) update.emails = { primaryEmail: email };

    if (Object.keys(update).length > 0) {
      execFileSync(
        "bash",
        [CRM_TOOL, "update-contact", contactId, JSON.stringify(update)],
        { timeout: 15000, encoding: "utf-8" }
      );
      console.log(
        `[linkedin-crm] Enriched contact ${contactId}: ${Object.keys(update).join(", ")}`
      );
    }

    if (companyName) {
      linkCompany(contactId, companyName);
    }
  } catch (err) {
    console.error(`[linkedin-crm] Enrichment error for ${contactId}:`, err);
  }
}

function linkCompany(contactId: string, companyName: string): void {
  if (!isLinkedInCrmShellAvailable()) return;
  try {
    const searchResult = execFileSync(
      "bash",
      [CRM_TOOL, "search-companies", companyName],
      { timeout: 15000, encoding: "utf-8" }
    );
    const companies = JSON.parse(searchResult) || [];

    let companyId: string | null = null;
    for (const c of companies) {
      if ((c.name || "").toLowerCase() === companyName.toLowerCase()) {
        companyId = c.id;
        break;
      }
    }
    if (!companyId && companies.length > 0) {
      companyId = companies[0].id;
    }
    if (!companyId) {
      const createResult = execFileSync(
        "bash",
        [CRM_TOOL, "create-company", JSON.stringify({ name: companyName })],
        { timeout: 15000, encoding: "utf-8" }
      );
      try {
        const data = JSON.parse(createResult);
        companyId = data?.id || null;
      } catch {
        // ignore
      }
    }

    if (companyId) {
      execFileSync(
        "bash",
        [CRM_TOOL, "update-contact", contactId, JSON.stringify({ companyId })],
        { timeout: 15000, encoding: "utf-8" }
      );
      console.log(
        `[linkedin-crm] Linked contact ${contactId} to company ${companyName}`
      );
    }
  } catch (err) {
    console.error(`[linkedin-crm] Company link error:`, err);
  }
}

// ── Connections Poller ───────────────────────────────────────────────────────

interface UnipileRelation {
  object: string;
  connection_urn: string;
  created_at: number;
  first_name: string;
  last_name: string;
  member_id: string;
  headline: string;
  public_identifier: string;
  public_profile_url: string;
}

interface ProcessedConnections {
  lastCheckedAt: string;
  processedIds: string[];
}

function loadProcessed(): ProcessedConnections {
  try {
    if (fs.existsSync(PROCESSED_FILE)) {
      return JSON.parse(fs.readFileSync(PROCESSED_FILE, "utf-8"));
    }
  } catch {
    // corrupt file — start fresh
  }
  return { lastCheckedAt: new Date().toISOString(), processedIds: [] };
}

function saveProcessed(data: ProcessedConnections): void {
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify(data, null, 2), "utf-8");
}

async function fetchRecentConnections(
  limit = 20
): Promise<UnipileRelation[]> {
  const dsn = normalizeUnipileDsn(process.env.UNIPILE_DSN);
  if (!UNIPILE_API_KEY || !dsn || !UNIPILE_ACCOUNT_ID) {
    console.warn("[linkedin-crm] Unipile not configured");
    return [];
  }

  const url = `https://${dsn}/api/v1/users/relations?account_id=${UNIPILE_ACCOUNT_ID}&limit=${limit}`;

  return new Promise((resolve) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: {
          "X-API-KEY": UNIPILE_API_KEY,
          accept: "application/json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            if (res.statusCode === 200) {
              recordUsageEvent({
                surface: "unipile_proxy",
                provider: "unipile",
                metadata: { path: "users/relations", limit },
              });
            }
            const parsed = JSON.parse(data);
            resolve(parsed.items || []);
          } catch {
            console.error("[linkedin-crm] Failed to parse Unipile response");
            resolve([]);
          }
        });
      }
    );
    req.on("error", (err) => {
      console.error("[linkedin-crm] Unipile fetch error:", err);
      resolve([]);
    });
    req.end();
  });
}

/**
 * Poll for new LinkedIn connections. Called by cron (30-minute schedule in registry).
 * Updates CRM from Unipile relation payload; no LLM triage.
 */
export async function checkNewConnections(): Promise<number> {
  if (!isLinkedInCrmShellAvailable()) return 0;
  const processed = loadProcessed();
  const relations = await fetchRecentConnections(20);

  if (relations.length === 0) return 0;

  const newConnections = relations.filter(
    (r) => !processed.processedIds.includes(r.member_id)
  );

  if (newConnections.length === 0) {
    processed.lastCheckedAt = new Date().toISOString();
    saveProcessed(processed);
    return 0;
  }

  console.log(
    `[linkedin-crm] Found ${newConnections.length} new connection(s)`
  );

  let posted = 0;

  for (const conn of newConnections) {
    const fullName = `${conn.first_name} ${conn.last_name}`.trim();
    const linkedinUrl =
      conn.public_profile_url ||
      `https://www.linkedin.com/in/${conn.public_identifier || conn.member_id}`;

    console.log(`[linkedin-crm] Processing new connection: ${fullName}`);

    // Find or create CRM contact
    const firstName = conn.first_name || "";
    const lastName = conn.last_name || "";
    const contactId = findOrCreateContact(fullName, conn.member_id);

    // Enrich contact from LinkedIn profile and set stage to ACCEPTED
    if (contactId) {
      const profileId = conn.public_identifier || conn.member_id;
      const profile = fetchLinkedInProfile(profileId);
      if (profile) {
        enrichContactFromLinkedIn(contactId, profile);
      }
      updatePersonStage(contactId, "ACCEPTED");
    }

    // Write CRM note (no AI — opening copy lives in your queue / workflows if needed)
    if (contactId) {
      writeNote(
        `LinkedIn Connection Accepted — ${fullName}`,
        [
          `${fullName} accepted your LinkedIn connection invitation.`,
          "",
          "**Type:** LinkedIn Connection Accepted",
          `**Headline:** ${conn.headline || "N/A"}`,
          `**Date:** ${new Date(conn.created_at).toISOString()}`,
          linkedinUrl ? `**LinkedIn Profile:** ${linkedinUrl}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        "person",
        contactId
      );
    }

    if (contactId) {
      try {
        const gen = await recordGeneralLinkedInInbound({
          crmContactId: contactId,
          senderProviderId: conn.public_identifier || conn.member_id,
          senderDisplayName: fullName,
          eventKind: "connection_accepted",
          timestampIso: new Date(conn.created_at).toISOString(),
        });
        if (!gen.ok && gen.reason) {
          console.log(`[linkedin-crm] Tim general inbox skipped: ${gen.reason}`);
        }
      } catch (e) {
        console.error("[linkedin-crm] recordGeneralLinkedInInbound error:", e);
      }
    }

    posted++;
    processed.processedIds.push(conn.member_id);
  }

  // Keep only last 500 processed IDs
  if (processed.processedIds.length > 500) {
    processed.processedIds = processed.processedIds.slice(-500);
  }

  processed.lastCheckedAt = new Date().toISOString();
  saveProcessed(processed);

  console.log(`[linkedin-crm] Processed ${posted} new connection(s)`);
  return posted;
}
