/**
 * Send a LinkedIn reply via the Unipile API and log it as a CRM note.
 */
import https from "https";
import { execFileSync } from "child_process";
import { join } from "path";

const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY || "";
const UNIPILE_DSN = process.env.UNIPILE_DSN || "";
const TOOL_SCRIPTS_PATH = process.env.TOOL_SCRIPTS_PATH || "/root/.nanobot/tools";
const CRM_TOOL = join(TOOL_SCRIPTS_PATH, "twenty_crm.sh");

/**
 * Send a message to a LinkedIn chat via Unipile.
 */
export async function sendLinkedInReply(
  chatId: string,
  messageText: string
): Promise<{ success: boolean; error?: string }> {
  if (!UNIPILE_API_KEY || !UNIPILE_DSN) {
    return { success: false, error: "Unipile API not configured" };
  }

  try {
    const body = JSON.stringify({ text: messageText });

    const result = await new Promise<string>((resolve, reject) => {
      const req = https.request(
        `https://${UNIPILE_DSN}/api/v1/chats/${chatId}/messages`,
        {
          method: "POST",
          headers: {
            "X-API-KEY": UNIPILE_API_KEY,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(`Unipile ${res.statusCode}: ${data}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    console.log(`[linkedin-reply] Sent reply to chat ${chatId}`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[linkedin-reply] Send failed:`, msg);
    return { success: false, error: msg };
  }
}

/**
 * Log an outbound reply as a CRM note on the contact.
 */
export function logReplyNote(
  contactId: string,
  senderName: string,
  replyText: string
): void {
  try {
    const title = `LinkedIn Reply to ${senderName}`;
    const content = [
      replyText,
      "",
      "**Type:** LinkedIn Outbound Reply (via Slack)",
      `**To:** ${senderName}`,
      `**Date:** ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT`,
    ].join("\n");

    execFileSync("bash", [CRM_TOOL, "write-note", title, content, "person", contactId], {
      timeout: 15000,
      encoding: "utf-8",
    });
  } catch (err) {
    console.error("[linkedin-reply] CRM note error:", err);
  }
}
