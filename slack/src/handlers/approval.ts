import type { App } from "@slack/bolt";
import { chat } from "../../../web/lib/gemini";
import { formatForSlack } from "../format.js";

/**
 * Approval keywords that indicate the agent is asking for permission to send/schedule.
 */
const APPROVAL_TRIGGERS = [
  "shall i send",
  "want me to send",
  "ready to send",
  "draft message",
  "drafted the following",
  "here's the draft",
  "approve this",
  "shall i schedule",
  "want me to schedule",
  "here is the message",
  "would you like me to send",
  "would you like me to schedule",
];

/**
 * Check if an agent response contains content that needs user approval.
 */
export function needsApproval(responseText: string): boolean {
  const lower = responseText.toLowerCase();
  return APPROVAL_TRIGGERS.some((trigger) => lower.includes(trigger));
}

/**
 * Register interactive button handlers for approval flows.
 */
export function registerApprovalHandlers(app: App, agentId: string): void {
  // Handle "Approve & Send" button clicks
  app.action(`approve_send_${agentId}`, async ({ ack, body, client, logger }) => {
    await ack();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = body as any;
    const channelId = b.channel?.id as string | undefined;
    const messageTs = b.message?.ts as string | undefined;
    const messageText = b.message?.text as string | undefined;

    if (!channelId || !messageTs) return;

    try {
      // Remove buttons from original message
      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: messageText || "Approved.",
        blocks: [],
      });

      // Post approval confirmation
      const thinking = await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: ":white_check_mark: Approved. Sending...",
      });

      // Call chat with approval phrase — passes hasUserApproval() check
      const reply = await chat(agentId, "go ahead and send");

      await client.chat.update({
        channel: channelId,
        ts: thinking.ts!,
        text: formatForSlack(reply),
      });
    } catch (error) {
      logger.error(`[${agentId}] Approval error:`, error);
    }
  });

  // Handle "Cancel" button clicks
  app.action(`cancel_send_${agentId}`, async ({ ack, body, client }) => {
    await ack();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = body as any;
    const channelId = b.channel?.id as string | undefined;
    const messageTs = b.message?.ts as string | undefined;

    if (!channelId || !messageTs) return;

    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: ":no_entry_sign: Cancelled.",
      blocks: [],
    });
  });
}

/**
 * Build Slack Block Kit approval buttons to append to a message.
 */
export function buildApprovalBlocks(agentId: string) {
  return [
    {
      type: "actions" as const,
      elements: [
        {
          type: "button" as const,
          text: { type: "plain_text" as const, text: "Approve & Send" },
          style: "primary" as const,
          action_id: `approve_send_${agentId}`,
        },
        {
          type: "button" as const,
          text: { type: "plain_text" as const, text: "Cancel" },
          style: "danger" as const,
          action_id: `cancel_send_${agentId}`,
        },
      ],
    },
  ];
}
