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
  type LinkedInMessageType,
} from "../linkedin-blocks.js";
import { sendLinkedInReply, sendNewLinkedInMessage, logReplyNote, scheduleLinkedInReply } from "../linkedin-reply.js";

/**
 * Register all LinkedIn action handlers on a Bolt app.
 */
export function registerLinkedInActionHandlers(app: App): void {
  // ── Ignore button ───────────────────────────────────────────────────────

  app.action("linkedin_ignore", async ({ ack, body, client, logger }) => {
    await ack();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = body as any;
    const channelId = b.channel?.id as string | undefined;
    const messageTs = b.message?.ts as string | undefined;
    const userId = b.user?.id as string | undefined;

    if (!channelId || !messageTs) return;

    try {
      const originalBlocks = b.message?.blocks || [];
      const params = extractParamsFromBlocks(originalBlocks, b.actions?.[0]?.value);

      if (params) {
        const updatedBlocks = buildLinkedInMessageBlocks(params, {
          text: ":no_entry_sign: Ignored",
          userId,
        });

        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `Ignored — LinkedIn message from ${params.senderName}`,
          blocks: updatedBlocks,
        });
      } else {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: ":no_entry_sign: Ignored",
          blocks: [],
        });
      }
    } catch (err) {
      logger.error("[linkedin-actions] ignore error:", err);
    }
  });

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
    const replyText = view.state.values.reply_input_block?.reply_text?.value;
    const sendTiming = view.state.values.send_timing_block?.send_timing?.selected_option?.value || "now";
    const scheduleDatetime = view.state.values.schedule_date_block?.schedule_datetime?.selected_date_time;

    // Validate: if "later" is selected, a datetime is required
    if (sendTiming === "later" && !scheduleDatetime) {
      await ack({
        response_action: "errors",
        errors: {
          schedule_date_block: "Please pick a date and time for Send Later",
        },
      });
      return;
    }

    await ack();

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

    if (sendTiming === "later" && scheduleDatetime) {
      // ── Schedule for later ──────────────────────────────────────────────
      const sendAt = new Date(scheduleDatetime * 1000).toISOString();

      scheduleLinkedInReply({
        chatId: meta.chat_id,
        linkedinUrl: meta.linkedin_url,
        messageText: replyText,
        senderName: meta.sender_name,
        contactId: meta.contact_id,
        sendAt,
        slackChannelId: meta.channel_id,
        slackMessageTs: meta.message_ts,
        scheduledBy: body.user.id,
      });

      // Update original Slack message
      try {
        const originalBlocks = await getOriginalBlocks(client, meta.channel_id, meta.message_ts);
        const params = extractParamsFromBlocks(originalBlocks, undefined);

        const formattedTime = new Date(sendAt).toLocaleString("en-US", {
          timeZone: "America/Los_Angeles",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });

        if (params) {
          const updatedBlocks = buildLinkedInMessageBlocks(params, {
            text: `:clock1: Reply scheduled for ${formattedTime} PT`,
            userId: body.user.id,
          });

          await client.chat.update({
            channel: meta.channel_id,
            ts: meta.message_ts,
            text: `Reply scheduled — LinkedIn message from ${meta.sender_name}`,
            blocks: updatedBlocks,
          });
        }
      } catch (err) {
        logger.error("[linkedin-actions] Could not update original message:", err);
      }

      // Thread confirmation
      try {
        const formattedTime = new Date(sendAt).toLocaleString("en-US", {
          timeZone: "America/Los_Angeles",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        await client.chat.postMessage({
          channel: meta.channel_id,
          thread_ts: meta.message_ts,
          text: `:clock1: Reply to ${meta.sender_name} scheduled for ${formattedTime} PT:\n>${replyText.slice(0, 300)}`,
        });
      } catch (err) {
        logger.error("[linkedin-actions] Thread confirmation error:", err);
      }
    } else {
      // ── Send now ────────────────────────────────────────────────────────
      // If no chat_id (new connection), use send-message with LinkedIn URL
      const result = meta.chat_id
        ? await sendLinkedInReply(meta.chat_id, replyText)
        : sendNewLinkedInMessage(meta.linkedin_url, replyText);

      if (result.success) {
        if (meta.contact_id) {
          logReplyNote(meta.contact_id, meta.sender_name, replyText);
        }

        // Update original message
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

        // Thread confirmation
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
        // Notify failure via DM
        try {
          await client.chat.postMessage({
            channel: body.user.id,
            text: `:x: Failed to send LinkedIn reply to ${meta.sender_name}: ${result.error}`,
          });
        } catch (err) {
          logger.error("[linkedin-actions] Error notification failed:", err);
        }
      }
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractParamsFromBlocks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blocks: any[],
  buttonValue: string | undefined
): LinkedInMessageParams | null {
  try {
    let metadata: ButtonMetadata | null = null;
    if (buttonValue) {
      try {
        metadata = JSON.parse(buttonValue);
      } catch {
        // ignore
      }
    }

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

    let messageText = "";
    for (const block of blocks) {
      if (block.type === "section" && block.text?.text?.startsWith(">")) {
        messageText = block.text.text.replace(/^>/gm, "").trim();
        break;
      }
    }

    let timestamp = new Date().toISOString();
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

    // Detect message type from the header block
    let messageType: LinkedInMessageType = "new_reply";
    const headerBlock = blocks[0];
    const headerText = headerBlock?.text?.text || "";
    if (headerText.includes(":handshake:")) {
      messageType = "new_connection";
    } else if (headerText.includes(":white_check_mark:") && headerText.includes("Accepted")) {
      messageType = "accepted_connection";
    }

    return {
      senderName: metadata.sender_name,
      messageText,
      linkedinUrl: metadata.linkedin_url,
      chatId: metadata.chat_id,
      contactId: metadata.contact_id,
      timestamp,
      messageType,
      triage:
        personSummary || campaignInfo || suggestedReply
          ? { personSummary, campaignInfo, suggestedReply }
          : undefined,
    };
  } catch {
    return null;
  }
}

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
