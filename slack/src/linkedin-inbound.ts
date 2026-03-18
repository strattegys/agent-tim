/**
 * Handles inbound LinkedIn messages from Unipile webhooks.
 * Matches/creates CRM contacts, logs notes, and sends Slack alerts.
 *
 * Delegates CRM operations to the shell script (twenty_crm.sh) to stay
 * consistent with the existing tooling.
 */
import { execFileSync } from "child_process";
import { join } from "path";
import https from "https";
import http from "http";
import type { WebClient } from "@slack/web-api";
import { getChannelId } from "./config.js";
import { triageLinkedInMessage, type TriageResult } from "./linkedin-triage.js";
import { buildLinkedInMessageBlocks } from "./linkedin-blocks.js";

const TOOL_SCRIPTS_PATH = process.env.TOOL_SCRIPTS_PATH || "/root/.nanobot/tools";
const CRM_TOOL = join(TOOL_SCRIPTS_PATH, "twenty_crm.sh");
const LINKEDIN_TOOL = join(TOOL_SCRIPTS_PATH, "linkedin.sh");

// Unipile config
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY || "";
const UNIPILE_DSN = process.env.UNIPILE_DSN || "";
const UNIPILE_ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || "";

// Govind's LinkedIn provider ID — used to identify outbound messages
const SELF_PROVIDER_ID = process.env.LINKEDIN_SELF_PROVIDER_ID || "ACoAAAFQFlkB-uguiq0-0980Ud_J2pdFMjzpQl8";

// Slack client for posting alerts (set by app.ts)
let slackClient: WebClient | undefined;
let slackBotToken: string | undefined;

export function setSlackBotToken(token: string) {
  slackBotToken = token;
}

export function setSlackClient(client: WebClient) {
  slackClient = client;
}

interface UnipileWebhookPayload {
  account_id: string;
  account_type: string;
  account_info?: { user_id?: string };
  event: string;
  chat_id: string;
  message_id: string;
  message: string;
  sender?: {
    attendee_id?: string;
    attendee_name?: string;
    attendee_provider_id?: string;
  };
  timestamp: string;
  webhook_name?: string;
}

/**
 * Main webhook handler — called from webhook-server.ts
 */
export async function handleUnipileWebhook(payload: UnipileWebhookPayload): Promise<void> {
  const event = payload.event;

  if (event !== "message_received") {
    console.log(`[linkedin] Ignoring event: ${event}`);
    return;
  }

  const senderName = payload.sender?.attendee_name || "Unknown";
  const senderProviderId = payload.sender?.attendee_provider_id || "";
  const messageText = payload.message || "";
  const chatId = payload.chat_id || "";
  const timestamp = payload.timestamp || new Date().toISOString();

  // Determine direction: outbound if sender is self
  const isOutbound =
    senderProviderId === SELF_PROVIDER_ID ||
    senderProviderId === payload.account_info?.user_id;

  if (isOutbound) {
    console.log(`[linkedin] Outbound message in chat ${chatId} — logging silently`);
    // For outbound, we need the recipient info from the chat
    await logOutboundMessage(chatId, messageText, timestamp);
    return;
  }

  console.log(`[linkedin] Inbound message from ${senderName} (${senderProviderId})`);

  // Find or create CRM contact
  const contactId = await findOrCreateContact(senderName, senderProviderId);
  if (!contactId) {
    console.error(`[linkedin] Could not find/create contact for ${senderName}`);
    return;
  }

  // Log as CRM note
  const formattedTime = formatTime(timestamp);
  const linkedinUrl = senderProviderId
    ? `https://www.linkedin.com/in/${senderProviderId}`
    : "";

  const noteTitle = `LinkedIn Message from ${senderName}`;
  const noteContent = [
    messageText,
    "",
    "**Type:** LinkedIn Inbound Message",
    `**From:** ${senderName}`,
    `**Date:** ${formattedTime}`,
    `**Chat ID:** ${chatId}`,
    linkedinUrl ? `**LinkedIn Profile:** ${linkedinUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  writeNote(noteTitle, noteContent, "person", contactId);

  // Triage via Tim's AI — get person summary, campaign context, suggested reply
  console.log(`[linkedin] Running triage for ${senderName}...`);
  const triage = await triageLinkedInMessage(senderName, messageText, contactId, linkedinUrl);

  // Post Slack alert with triage context and action buttons
  await postSlackAlert(senderName, messageText, linkedinUrl, chatId, contactId, timestamp, triage);

  console.log(`[linkedin] Processed inbound from ${senderName} → contact ${contactId}`);
}

/**
 * Log outbound message — fetch chat attendee info and create CRM note
 */
async function logOutboundMessage(
  chatId: string,
  messageText: string,
  timestamp: string
): Promise<void> {
  try {
    // Get chat details to find the recipient
    const chatMessages = execFileSync("bash", [LINKEDIN_TOOL, "get-chat-messages", chatId], {
      timeout: 30000,
      encoding: "utf-8",
    });
    // The chat list response includes attendee_provider_id — but for now
    // just log a generic note. We can enhance this later.
    console.log(`[linkedin] Outbound message logged for chat ${chatId}`);
  } catch {
    // Silently ignore outbound logging failures
  }
}

// ── CRM Operations ──────────────────────────────────────────────────────────

function searchContacts(query: string): Array<{ id: string; name?: { firstName?: string; lastName?: string }; linkedinLink?: { primaryLinkUrl?: string; secondaryLinks?: Array<{ url?: string }> } }> {
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

function createContact(firstName: string, lastName: string, linkedinUrl?: string): string | null {
  try {
    const payload: Record<string, string> = { firstName, lastName };
    if (linkedinUrl) {
      payload.linkedinUrl = linkedinUrl;
    }
    const result = execFileSync(
      "bash",
      [CRM_TOOL, "create-contact", JSON.stringify(payload)],
      { timeout: 15000, encoding: "utf-8" }
    );
    // Shell script outputs human-readable text like "Contact created successfully!\n  ID: uuid\n  Name: ..."
    // Extract the ID from the output
    const idMatch = result.match(/ID:\s+([a-f0-9-]{36})/);
    if (idMatch) {
      return idMatch[1];
    }
    // Fallback: try JSON parse in case format changes
    try {
      const data = JSON.parse(result);
      return data?.data?.createPerson?.id || null;
    } catch {
      console.warn("[linkedin] Could not parse create-contact output:", result.slice(0, 200));
      return null;
    }
  } catch (err) {
    console.error("[linkedin] Create contact error:", err);
    return null;
  }
}

function writeNote(title: string, content: string, targetType: string, targetId: string): void {
  try {
    execFileSync("bash", [CRM_TOOL, "write-note", title, content, targetType, targetId], {
      timeout: 15000,
      encoding: "utf-8",
    });
  } catch (err) {
    console.error("[linkedin] Write note error:", err);
  }
}

/**
 * Find a CRM contact by LinkedIn provider ID, then by name.
 * Creates a new contact if not found.
 */
async function findOrCreateContact(
  senderName: string,
  senderProviderId: string
): Promise<string | null> {
  // Build a LinkedIn URL from the provider ID for searching
  const linkedinUrl = senderProviderId
    ? `https://www.linkedin.com/in/${senderProviderId}`
    : "";

  // Strategy 1: Search by name
  const nameParts = senderName.split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  if (firstName) {
    const contacts = searchContacts(senderName);
    for (const c of contacts) {
      // Match by LinkedIn URL
      const primaryUrl = c.linkedinLink?.primaryLinkUrl || "";
      if (senderProviderId && primaryUrl.includes(senderProviderId)) {
        return c.id;
      }
      // Match by secondary links
      for (const sec of c.linkedinLink?.secondaryLinks || []) {
        if (senderProviderId && (sec.url || "").includes(senderProviderId)) {
          return c.id;
        }
      }
      // Match by name (exact)
      const cFirst = (c.name?.firstName || "").toLowerCase();
      const cLast = (c.name?.lastName || "").toLowerCase();
      if (cFirst === firstName.toLowerCase() && cLast === lastName.toLowerCase()) {
        return c.id;
      }
    }
  }

  // Not found — create
  console.log(`[linkedin] Creating new contact: ${senderName}`);
  return createContact(firstName, lastName, linkedinUrl);
}

// ── Slack Alert ──────────────────────────────────────────────────────────────

async function postSlackAlert(
  senderName: string,
  messageText: string,
  linkedinUrl: string,
  chatId: string,
  contactId: string | null,
  timestamp: string,
  triage: TriageResult
): Promise<void> {
  const channel = getChannelId("linkedin");

  if (!channel) {
    console.warn("[linkedin] No linkedin channel configured — skipping alert");
    return;
  }

  const blocks = buildLinkedInMessageBlocks({
    senderName,
    messageText,
    linkedinUrl,
    chatId,
    contactId,
    timestamp,
    triage: triage.personSummary || triage.campaignInfo || triage.suggestedReply
      ? triage
      : undefined,
  });

  const fallbackText = `:incoming_envelope: LinkedIn message from ${senderName}: ${messageText.slice(0, 200)}`;

  // Prefer Bolt WebClient (supports blocks + interactivity routing)
  if (slackClient) {
    try {
      await slackClient.chat.postMessage({
        channel,
        text: fallbackText,
        blocks,
        unfurl_links: false,
      });
      return;
    } catch (err) {
      console.error("[linkedin] Slack WebClient alert error:", err);
    }
  }

  // Fallback to raw HTTPS if no WebClient available
  const token = slackBotToken || process.env.SLACK_TIM_BOT_TOKEN;
  if (!token) {
    console.warn("[linkedin] No Slack token configured — skipping alert");
    return;
  }

  try {
    const body = JSON.stringify({
      channel,
      text: fallbackText,
      blocks,
      unfurl_links: false,
    });

    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        "https://slack.com/api/chat.postMessage",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          resolve();
        }
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  } catch (err) {
    console.error("[linkedin] Slack alert error:", err);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) + " PT";
  } catch {
    return isoString;
  }
}
