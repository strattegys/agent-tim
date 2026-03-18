/**
 * Block Kit builders for LinkedIn inbound messages and reply modal.
 */
import type { KnownBlock } from "@slack/types";
import type { ModalView } from "@slack/types";
import type { TriageResult } from "./linkedin-triage.js";

export interface LinkedInMessageParams {
  senderName: string;
  messageText: string;
  linkedinUrl: string;
  chatId: string;
  contactId: string | null;
  timestamp: string;
  triage?: TriageResult;
}

export interface ButtonMetadata {
  chat_id: string;
  sender_name: string;
  contact_id: string | null;
  linkedin_url: string;
  suggested_reply: string;
}

/**
 * Build Block Kit blocks for a LinkedIn inbound message.
 * When `status` is provided, buttons are replaced with a status badge.
 */
export function buildLinkedInMessageBlocks(
  params: LinkedInMessageParams,
  status?: { text: string; userId?: string }
): KnownBlock[] {
  const { senderName, messageText, linkedinUrl, chatId, contactId, timestamp, triage } = params;

  const profileLink = linkedinUrl
    ? `<${linkedinUrl}|${senderName}>`
    : senderName;

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:incoming_envelope: *LinkedIn Message from ${profileLink}*`,
      },
    },
  ];

  // Person summary from triage
  if (triage?.personSummary) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:bust_in_silhouette: ${triage.personSummary}`,
      },
    });
  }

  // Campaign context from triage
  if (triage?.campaignInfo && triage.campaignInfo.toLowerCase() !== "none") {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:dart: *Campaign:* ${triage.campaignInfo}`,
      },
    });
  }

  // Original message
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `>${messageText.slice(0, 500).replace(/\n/g, "\n>")}`,
    },
  });

  // Tim's suggested reply
  if (triage?.suggestedReply) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:robot_face: *Suggested reply:*\n_${triage.suggestedReply}_`,
      },
    });
  }

  // Timestamp context
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Received ${formatTimestamp(timestamp)}`,
      },
    ],
  });

  if (status) {
    // Status badge instead of buttons
    const statusBy = status.userId ? ` by <@${status.userId}>` : "";
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${status.text}${statusBy}`,
        },
      ],
    });
  } else {
    // Action buttons
    const metadata: ButtonMetadata = {
      chat_id: chatId,
      sender_name: senderName,
      contact_id: contactId,
      linkedin_url: linkedinUrl,
      suggested_reply: triage?.suggestedReply || "",
    };

    // Slack button value max is 2000 chars — truncate suggested_reply if needed
    let metaJson = JSON.stringify(metadata);
    if (metaJson.length > 1900) {
      metadata.suggested_reply = metadata.suggested_reply.slice(0, 500);
      metaJson = JSON.stringify(metadata);
    }

    blocks.push({
      type: "actions",
      block_id: "linkedin_actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: ":speech_balloon: Reply", emoji: true },
          action_id: "linkedin_reply",
          style: "primary",
          value: metaJson,
        },
        {
          type: "button",
          text: { type: "plain_text", text: ":eyes: Handle", emoji: true },
          action_id: "linkedin_handle",
          value: metaJson,
        },
        {
          type: "button",
          text: { type: "plain_text", text: ":white_check_mark: Replied", emoji: true },
          action_id: "linkedin_replied",
          value: metaJson,
        },
        {
          type: "button",
          text: { type: "plain_text", text: ":no_entry_sign: Ignore", emoji: true },
          action_id: "linkedin_ignore",
          value: metaJson,
        },
      ],
    } as KnownBlock);
  }

  return blocks;
}

/**
 * Build the Reply modal view with pre-filled suggested reply.
 */
export function buildLinkedInReplyModal(
  senderName: string,
  suggestedReply: string,
  privateMetadata: string
): ModalView {
  return {
    type: "modal",
    callback_id: "linkedin_reply_modal",
    private_metadata: privateMetadata,
    title: { type: "plain_text", text: "Reply on LinkedIn" },
    submit: { type: "plain_text", text: "Send" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Replying to *${senderName}* on LinkedIn`,
        },
      },
      {
        type: "input",
        block_id: "reply_input_block",
        element: {
          type: "plain_text_input",
          action_id: "reply_text",
          multiline: true,
          initial_value: suggestedReply,
          placeholder: { type: "plain_text", text: "Type your reply..." },
        },
        label: { type: "plain_text", text: "Message" },
      },
    ],
  };
}

function formatTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) + " PT";
  } catch {
    return isoString;
  }
}
