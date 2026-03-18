/**
 * Polls Unipile for new LinkedIn connections and posts them to Slack
 * with Tim's triage (person summary + suggested opening message).
 *
 * Tracks processed connections in a local file to avoid duplicates.
 */
import https from "https";
import fs from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import type { WebClient } from "@slack/web-api";
import { getChannelId } from "./config.js";
import { triageNewConnection } from "./linkedin-triage.js";
import { buildLinkedInMessageBlocks } from "./linkedin-blocks.js";

const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY || "";
const UNIPILE_DSN = process.env.UNIPILE_DSN || "";
const UNIPILE_ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || "";

const TOOL_SCRIPTS_PATH = process.env.TOOL_SCRIPTS_PATH || "/root/.nanobot/tools";
const CRM_TOOL = join(TOOL_SCRIPTS_PATH, "twenty_crm.sh");

const PROCESSED_FILE = process.env.LINKEDIN_CONNECTIONS_PROCESSED || "/root/.nanobot/linkedin_connections_processed.json";

interface UnipileRelation {
  object: string;
  connection_urn: string;
  created_at: number; // epoch ms
  first_name: string;
  last_name: string;
  member_id: string; // ACoAAA provider ID
  headline: string;
  public_identifier: string;
  public_profile_url: string;
  profile_picture_url?: string;
}

interface ProcessedConnections {
  lastCheckedAt: string; // ISO timestamp
  processedIds: string[]; // member_ids we've already posted
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

/**
 * Fetch recent connections from Unipile sorted by created_at desc.
 */
async function fetchRecentConnections(limit = 20): Promise<UnipileRelation[]> {
  if (!UNIPILE_API_KEY || !UNIPILE_DSN || !UNIPILE_ACCOUNT_ID) {
    console.warn("[connections] Unipile not configured");
    return [];
  }

  const url = `https://${UNIPILE_DSN}/api/v1/users/relations?account_id=${UNIPILE_ACCOUNT_ID}&limit=${limit}`;

  return new Promise((resolve) => {
    const req = https.request(url, {
      method: "GET",
      headers: {
        "X-API-KEY": UNIPILE_API_KEY,
        "accept": "application/json",
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.items || []);
        } catch {
          console.error("[connections] Failed to parse Unipile response");
          resolve([]);
        }
      });
    });
    req.on("error", (err) => {
      console.error("[connections] Unipile fetch error:", err);
      resolve([]);
    });
    req.end();
  });
}

/**
 * Find or create a CRM contact for a new connection.
 */
function findOrCreateCrmContact(
  firstName: string,
  lastName: string,
  linkedinUrl: string
): string | null {
  const fullName = `${firstName} ${lastName}`.trim();

  // Search by name
  try {
    const result = execFileSync("bash", [CRM_TOOL, "search-contacts", fullName], {
      timeout: 15000,
      encoding: "utf-8",
    });
    const data = JSON.parse(result);
    const contacts = data?.data?.people || [];

    for (const c of contacts) {
      // Match by LinkedIn URL
      const primaryUrl = c.linkedinLink?.primaryLinkUrl || "";
      if (primaryUrl && linkedinUrl && (primaryUrl.includes(linkedinUrl) || linkedinUrl.includes(primaryUrl.replace(/\/$/, "")))) {
        return c.id;
      }
      // Match by name
      const cFirst = (c.name?.firstName || "").toLowerCase();
      const cLast = (c.name?.lastName || "").toLowerCase();
      if (cFirst === firstName.toLowerCase() && cLast === lastName.toLowerCase()) {
        return c.id;
      }
    }
  } catch {
    // search failed
  }

  // Create new contact
  try {
    const payload: Record<string, string> = { firstName, lastName };
    if (linkedinUrl) payload.linkedinUrl = linkedinUrl;
    const result = execFileSync(
      "bash",
      [CRM_TOOL, "create-contact", JSON.stringify(payload)],
      { timeout: 15000, encoding: "utf-8" }
    );
    const idMatch = result.match(/ID:\s+([a-f0-9-]{36})/);
    if (idMatch) return idMatch[1];
    try {
      const data = JSON.parse(result);
      return data?.data?.createPerson?.id || null;
    } catch {
      return null;
    }
  } catch (err) {
    console.error("[connections] Create contact error:", err);
    return null;
  }
}

/**
 * Main poller — called by cron every 10 minutes.
 * Returns the number of new connections posted to Slack.
 */
export async function checkNewConnections(slackClient?: WebClient): Promise<number> {
  const processed = loadProcessed();
  const relations = await fetchRecentConnections(20);

  if (relations.length === 0) return 0;

  // Find connections we haven't processed yet
  const newConnections = relations.filter(
    (r) => !processed.processedIds.includes(r.member_id)
  );

  if (newConnections.length === 0) {
    processed.lastCheckedAt = new Date().toISOString();
    saveProcessed(processed);
    return 0;
  }

  console.log(`[connections] Found ${newConnections.length} new connection(s)`);

  const channel = getChannelId("linkedin");
  if (!channel) {
    console.warn("[connections] No linkedin channel configured");
    return 0;
  }

  let posted = 0;

  for (const conn of newConnections) {
    const fullName = `${conn.first_name} ${conn.last_name}`.trim();
    const linkedinUrl = conn.public_profile_url || `https://www.linkedin.com/in/${conn.public_identifier || conn.member_id}`;

    console.log(`[connections] Processing new connection: ${fullName}`);

    // Find or create CRM contact
    const contactId = findOrCreateCrmContact(conn.first_name, conn.last_name, linkedinUrl);

    // Triage — Tim suggests an opening message
    const triage = await triageNewConnection(
      fullName,
      conn.headline || "",
      contactId,
      linkedinUrl
    );

    // Build and post Slack message
    const messageText = `[New connection — ${conn.headline || "no headline"}]`;

    const blocks = buildLinkedInMessageBlocks({
      senderName: fullName,
      messageText,
      linkedinUrl,
      chatId: "", // no chat yet — Reply will use send-message
      contactId,
      timestamp: new Date(conn.created_at).toISOString(),
      messageType: "new_connection",
      triage: triage.personSummary || triage.campaignInfo || triage.suggestedReply
        ? triage
        : undefined,
    });

    const fallbackText = `:handshake: New LinkedIn connection: ${fullName} — ${conn.headline || ""}`;

    if (slackClient) {
      try {
        await slackClient.chat.postMessage({
          channel,
          text: fallbackText,
          blocks,
          unfurl_links: false,
        });
        posted++;
      } catch (err) {
        console.error(`[connections] Slack post error for ${fullName}:`, err);
      }
    }

    // Mark as processed even if Slack post fails (to avoid retrying forever)
    processed.processedIds.push(conn.member_id);
  }

  // Keep only the last 500 processed IDs to prevent unbounded growth
  if (processed.processedIds.length > 500) {
    processed.processedIds = processed.processedIds.slice(-500);
  }

  processed.lastCheckedAt = new Date().toISOString();
  saveProcessed(processed);

  console.log(`[connections] Posted ${posted} new connection(s) to Slack`);
  return posted;
}
