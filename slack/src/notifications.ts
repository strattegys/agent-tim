import type { WebClient } from "@slack/web-api";
import { getChannelId } from "./config.js";

interface HeartbeatFinding {
  category: string;
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
}

const priorityEmoji: Record<string, string> = {
  high: ":red_circle:",
  medium: ":large_orange_circle:",
  low: ":white_circle:",
};

const GOVIND_SLACK_ID = "U0ALW9ER8PL";

/**
 * Post heartbeat findings to the #alerts channel.
 * Also DMs Govind if there are due reminders or high-priority items.
 */
export async function postHeartbeatFindings(
  client: WebClient,
  findings: HeartbeatFinding[],
  agentId: string
): Promise<void> {
  const channel = getChannelId("alerts");
  if (!channel) {
    console.warn("[notifications] SLACK_ALERTS_CHANNEL not set, skipping notification");
    return;
  }

  if (findings.length === 0) return;

  const lines = findings.map(
    (f) =>
      `${priorityEmoji[f.priority] || ":white_circle:"} *[${f.priority.toUpperCase()}] ${f.title}*\n${f.detail}`
  );

  const agentName = agentId.charAt(0).toUpperCase() + agentId.slice(1);

  await client.chat.postMessage({
    channel,
    text: `:heartbeat: *${agentName} Heartbeat* — ${findings.length} finding(s)\n\n${lines.join("\n\n")}`,
    unfurl_links: false,
  });

  // DM Govind for due reminders and high-priority items
  const urgent = findings.filter(
    (f) => f.priority === "high" || f.category === "reminder"
  );
  if (urgent.length > 0) {
    try {
      const conv = await client.conversations.open({ users: GOVIND_SLACK_ID });
      if (conv.channel?.id) {
        const dmLines = urgent.map(
          (f) => `${priorityEmoji[f.priority] || ":white_circle:"} *${f.title}*\n${f.detail}`
        );
        await client.chat.postMessage({
          channel: conv.channel.id,
          text: `:bell: *Reminder Check*\n\n${dmLines.join("\n\n")}`,
          unfurl_links: false,
        });
      }
    } catch (err) {
      console.error("[notifications] Failed to DM Govind:", err);
    }
  }
}

/**
 * Post a LinkedIn message alert to #linkedin-msg channel.
 */
export async function postLinkedInMessage(
  client: WebClient,
  senderName: string,
  messageText: string,
  linkedinUrl: string,
  timestamp: string
): Promise<void> {
  const channel = getChannelId("linkedin");
  if (!channel) {
    console.warn("[notifications] SLACK_LINKEDIN_CHANNEL not set, skipping LinkedIn notification");
    return;
  }

  const truncated = messageText.length > 500
    ? messageText.slice(0, 500) + "..."
    : messageText;

  await client.chat.postMessage({
    channel,
    text: `:incoming_envelope: *New LinkedIn Message*\n*From:* ${senderName}\n*Profile:* ${linkedinUrl}\n*Time:* ${timestamp}\n\n>${truncated.split("\n").join("\n>")}`,
    unfurl_links: false,
  });
}

/**
 * Post a delegation event to the ops/research channel.
 */
export async function postDelegation(
  fromClient: WebClient,
  toClient: WebClient,
  fromAgent: string,
  toAgent: string,
  task: string,
  result: string
): Promise<void> {
  const channel = getChannelId("research") || getChannelId("ops");
  if (!channel) return;

  const fromName = fromAgent.charAt(0).toUpperCase() + fromAgent.slice(1);
  const toName = toAgent.charAt(0).toUpperCase() + toAgent.slice(1);

  // Post task from the requesting agent
  const taskMsg = await fromClient.chat.postMessage({
    channel,
    text: `:arrow_right: *${fromName} → ${toName}*\n${task}`,
    unfurl_links: false,
  });

  // Reply with result from the target agent
  if (taskMsg.ts) {
    await toClient.chat.postMessage({
      channel,
      thread_ts: taskMsg.ts,
      text: `:white_check_mark: *${toName} completed:*\n${result.slice(0, 3000)}${result.length > 3000 ? "\n_(truncated)_" : ""}`,
      unfurl_links: false,
    });
  }
}
