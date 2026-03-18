/**
 * Interactive button and modal handlers for LinkedIn inbound messages.
 * Registered on Tim's Bolt app only.
 */
import type { App } from "@slack/bolt";
import {
  buildLinkedInMessageBlocks,
  buildLinkedInReplyModal,
  type ButtonMetadata,
  type LinkedInMessageParams,
} from "../linkedin-blocks.js";
import { sendLinkedInReply, logReplyNote } from "../linkedin-reply.js";

/**
 * Register all LinkedIn action handlers on a Bolt app.
 */
export function registerLinkedInActionHandlers(app: App): void {
  // ── Status buttons ──────────────────────────────────────────────────────

  const statusHandlers: Array<{
    actionId: string;
    statusText: string;
  }> = [
    { actionId: "linkedin_handle", statusText: ":eyes: Being handled" },
    { actionId: "linkedin_replied", statusText: ":white_check_mark: Replied" },
    { actionId: "linkedin_ignore", statusText: ":no_entry_sign: Ignored" },
  ];

  for (const { actionId, statusText } of statusHandlers) {
    app.action(actionId, async ({ ack, body, client, logger }) => {
      await ack();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = body as any;
      const channelId = b.channel?.id as string | undefined;
      const messageTs = b.message?.ts as string | undefined;
      const userId = b.user?.id as string | undefined;

      if (!channelId || !messageTs) return;

      try {
        // Extract original message params from the blocks
        const originalBlocks = b.message?.blocks || [];
        const params = extractParamsFromBlocks(originalBlocks, b.actions?.[0]?.value);

        if (params) {
          const updatedBlocks = buildLinkedInMessageBlocks(params, {
            text: statusText,
            userId,
          });

          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: `${statusText} — LinkedIn message from ${params.senderName}`,
            blocks: updatedBlocks,
          });
        } else {
          // Fallback: just remove blocks and show status
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: `${statusText}`,
            blocks: [],
          });
        }
      } catch (err) {
        logger.error(`[linkedin-actions] ${actionId} error:`, err);
      }
    });
  }

  // ── Reply button → opens modal ──────────────────────────────────────────

  app.action("linkedin_reply", async ({ ack, body, client, logger }) => {
    await ack();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = body as any;
    const triggerId = b.trigger_id as string | undefined;
    const channelId = b.channel?.id as string | undefined;
    const messageTs = b.message?.ts as string | undefined;
    const actionValue = b.actions?.[0]?.value as string | undefined;

    if (!triggerId || !channelId || !messageTs || !actionValue) return;

    try {
      const metadata: ButtonMetadata = JSON.parse(actionValue);

      // Encode channel/message info so the modal submission can update the original message
      const privateMetadata = JSON.stringify({
        chat_id: metadata.chat_id,
        sender_name: metadata.sender_name,
        contact_id: metadata.contact_id,
        linkedin_url: metadata.linkedin_url,
        channel_id: channelId,
        message_ts: messageTs,
      });

      const modal = buildLinkedInReplyModal(
        metadata.sender_name,
        metadata.suggested_reply,
        privateMetadata
      );

      await client.views.open({
        trigger_id: triggerId,
        view: modal,
      });
    } catch (err) {
      logger.error("[linkedin-actions] Reply modal error:", err);
    }
  });

  // ── Modal submission ────────────────────────────────────────────────────

  app.view("linkedin_reply_modal", async ({ ack, view, client, body, logger }) => {
    await ack();

    const replyText = view.state.values.reply_input_block?.reply_text?.value;
    if (!replyText) return;

    let meta: {
      chat_id: string;
      sender_name: string;
      contact_id: string | null;
      linkedin_url: string;
      channel_id: string;
      message_ts: string;
    };

    try {
      meta = JSON.parse(view.private_metadata);
    } catch {
      logger.error("[linkedin-actions] Could not parse modal private_metadata");
      return;
    }

    // Send the reply via Unipile
    const result = await sendLinkedInReply(meta.chat_id, replyText);

    if (result.success) {
      // Log as CRM note
      if (meta.contact_id) {
        logReplyNote(meta.contact_id, meta.sender_name, replyText);
      }

      // Update the original Slack message to show "Replied" status
      try {
        const originalBlocks = await getOriginalBlocks(client, meta.channel_id, meta.message_ts);
        const params = extractParamsFromBlocks(originalBlocks, undefined);

        if (params) {
          const updatedBlocks = buildLinkedInMessageBlocks(params, {
            text: ":white_check_mark: Replied",
            userId: body.user.id,
          });

          await client.chat.update({
            channel: meta.channel_id,
            ts: meta.message_ts,
            text: `Replied — LinkedIn message from ${meta.sender_name}`,
            blocks: updatedBlocks,
          });
        }
      } catch (err) {
        logger.error("[linkedin-actions] Could not update original message:", err);
      }

      // Post thread confirmation
      try {
        await client.chat.postMessage({
          channel: meta.channel_id,
          thread_ts: meta.message_ts,
          text: `:white_check_mark: Reply sent to ${meta.sender_name}:\n>${replyText.slice(0, 300)}`,
        });
      } catch (err) {
        logger.error("[linkedin-actions] Thread confirmation error:", err);
      }
    } else {
      // Notify user of failure via DM
      try {
        await client.chat.postMessage({
          channel: body.user.id,
          text: `:x: Failed to send LinkedIn reply to ${meta.sender_name}: ${result.error}`,
        });
      } catch (err) {
        logger.error("[linkedin-actions] Error notification failed:", err);
      }
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract LinkedInMessageParams from the original message blocks and button metadata.
 * Used to rebuild blocks with updated status.
 */
function extractParamsFromBlocks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blocks: any[],
  buttonValue: string | undefined
): LinkedInMessageParams | null {
  try {
    // Try to parse metadata from button value first
    let metadata: ButtonMetadata | null = null;
    if (buttonValue) {
      try {
        metadata = JSON.parse(buttonValue);
      } catch {
        // ignore
      }
    }

    // If no button value, try to find it from the actions block
    if (!metadata) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const actionsBlock = blocks.find((b: any) => b.block_id === "linkedin_actions");
      const firstButton = actionsBlock?.elements?.[0];
      if (firstButton?.value) {
        try {
          metadata = JSON.parse(firstButton.value);
        } catch {
          // ignore
        }
      }
    }

    if (!metadata) return null;

    // Extract the original message text from the quoted section block
    let messageText = "";
    for (const block of blocks) {
      if (block.type === "section" && block.text?.text?.startsWith(">")) {
        messageText = block.text.text.replace(/^>/gm, "").trim();
        break;
      }
    }

    // Extract timestamp from context block
    let timestamp = new Date().toISOString();
    for (const block of blocks) {
      if (block.type === "context" && block.elements?.[0]?.text?.startsWith("Received ")) {
        // We can't reliably reverse-parse the formatted timestamp, so use current time
        break;
      }
    }

    // Extract triage info from blocks
    let personSummary = "";
    let campaignInfo = "";
    let suggestedReply = metadata.suggested_reply || "";

    for (const block of blocks) {
      const text = block.text?.text || "";
      if (text.startsWith(":bust_in_silhouette:")) {
        personSummary = text.replace(":bust_in_silhouette: ", "");
      } else if (text.startsWith(":dart:")) {
        campaignInfo = text.replace(":dart: *Campaign:* ", "");
      }
    }

    return {
      senderName: metadata.sender_name,
      messageText,
      linkedinUrl: metadata.linkedin_url,
      chatId: metadata.chat_id,
      contactId: metadata.contact_id,
      timestamp,
      triage:
        personSummary || campaignInfo || suggestedReply
          ? { personSummary, campaignInfo, suggestedReply }
          : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch the original message blocks from Slack.
 * Used after modal submission when we don't have the blocks in the body.
 */
async function getOriginalBlocks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  channelId: string,
  messageTs: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  try {
    const result = await client.conversations.history({
      channel: channelId,
      latest: messageTs,
      inclusive: true,
      limit: 1,
    });
    return result.messages?.[0]?.blocks || [];
  } catch {
    return [];
  }
}
