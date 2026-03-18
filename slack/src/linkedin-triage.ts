/**
 * LinkedIn message triage via Tim's AI.
 * Before posting to Slack, Tim analyzes the sender (CRM person summary,
 * campaign context) and suggests a reply.
 */
import { chat } from "../../web/lib/gemini";
import { dirname } from "path";
import { getAgentConfig } from "../../web/lib/agent-config";

export interface TriageResult {
  personSummary: string;
  campaignInfo: string;
  suggestedReply: string;
}

const TRIAGE_TIMEOUT_MS = 60_000; // 60s max for triage

/**
 * Dedicated session file for triage — separate from Tim's main Slack session.
 * Each triage call is effectively stateless (session accumulates but doesn't
 * pollute Tim's main conversation).
 */
function getTriageSessionFile(): string {
  const config = getAgentConfig("tim");
  const sessionDir = dirname(config.sessionFile);
  return `${sessionDir}/linkedin_triage.jsonl`;
}

/**
 * Ask Tim to triage an inbound LinkedIn message.
 * Returns structured person summary, campaign info, and suggested reply.
 * On failure/timeout, returns a fallback with empty fields.
 */
export async function triageLinkedInMessage(
  senderName: string,
  messageText: string,
  contactId: string,
  linkedinUrl: string
): Promise<TriageResult> {
  const fallback: TriageResult = {
    personSummary: "",
    campaignInfo: "",
    suggestedReply: "",
  };

  const prompt = [
    `You just received a LinkedIn message. Triage it by looking up the sender in the CRM and providing context.`,
    ``,
    `**Sender:** ${senderName}`,
    `**CRM Contact ID:** ${contactId}`,
    linkedinUrl ? `**LinkedIn:** ${linkedinUrl}` : "",
    ``,
    `**Message:**`,
    `> ${messageText.slice(0, 1000)}`,
    ``,
    `Instructions:`,
    `1. Look up this person in the CRM using their contact ID (use get-person ${contactId})`,
    `2. Check if they have an active campaign (use get-campaign-context ${contactId})`,
    `3. Respond in EXACTLY this format with no extra text:`,
    ``,
    `PERSON_SUMMARY: <1-2 sentence summary of who they are — role, company, key context>`,
    `CAMPAIGN_INFO: <campaign name and stage if any, otherwise "None">`,
    `SUGGESTED_REPLY: <a short, natural reply to their message based on context>`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  try {
    const response = await Promise.race([
      chat("tim", prompt, { sessionFile: getTriageSessionFile() }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Triage timeout")), TRIAGE_TIMEOUT_MS)
      ),
    ]);

    return parseTriageResponse(response);
  } catch (err) {
    console.error("[linkedin-triage] Triage failed, using fallback:", err);
    return fallback;
  }
}

/**
 * Parse Tim's structured response into a TriageResult.
 */
function parseTriageResponse(response: string): TriageResult {
  const extract = (label: string): string => {
    const regex = new RegExp(`${label}:\\s*(.+?)(?=\\n[A-Z_]+:|$)`, "s");
    const match = response.match(regex);
    return match?.[1]?.trim() || "";
  };

  return {
    personSummary: extract("PERSON_SUMMARY"),
    campaignInfo: extract("CAMPAIGN_INFO"),
    suggestedReply: extract("SUGGESTED_REPLY"),
  };
}
