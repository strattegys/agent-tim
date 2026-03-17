import type { WebClient } from "@slack/web-api";
import { getBotApp } from "./app.js";
import { getChannelId } from "./config.js";
import { formatForSlack } from "./format.js";

/**
 * Resolve a channel name to a channel ID.
 * Supports: named shortcuts (alerts, ops, research), channel names, or raw IDs.
 */
async function resolveChannel(client: WebClient, channel: string): Promise<string | undefined> {
  // Check named shortcuts first
  const shortcut = getChannelId(channel as any);
  if (shortcut) return shortcut;

  // Already a channel ID (starts with C or D)
  if (/^[CD][A-Z0-9]+$/.test(channel)) return channel;

  // Look up by name
  try {
    const result = await client.conversations.list({
      types: "public_channel,private_channel",
      limit: 200,
    });
    const match = result.channels?.find(
      (c) => c.name === channel || c.name === channel.replace(/^#/, "")
    );
    return match?.id;
  } catch {
    return undefined;
  }
}

/**
 * Execute a Slack tool command using the calling agent's bot client.
 */
export async function executeSlackTool(
  agentId: string,
  command: string,
  args: Record<string, string>
): Promise<string> {
  // Normalize: Gemini sometimes uses underscores instead of hyphens
  const normalizedCommand = command.replace(/_/g, "-");
  // Gemini sometimes uses alternative param names — normalize them all
  if (args.message && !args.text) args.text = args.message;
  if (args.arg2 && !args.text) args.text = args.arg2;
  if (args.arg1 && !args.channel) args.channel = args.arg1;
  if (args.arg1 && !args.user_id && normalizedCommand === "dm-user") args.user_id = args.arg1;
  if (args.channel_name && !args.channel) args.channel = args.channel_name;
  if (args.channel_id && !args.channel) args.channel = args.channel_id;

  console.log(`[slack-tool] agent=${agentId} command=${normalizedCommand} args=${JSON.stringify(args)}`);
  const botApp = getBotApp(agentId);
  if (!botApp) {
    return `Error: No Slack app found for agent "${agentId}"`;
  }
  const client = botApp.app.client;

  try {
    switch (normalizedCommand) {
      case "post-message": {
        if (!args.channel) return "Error: channel is required";
        if (!args.text) return "Error: text is required";
        const channelId = await resolveChannel(client, args.channel);
        if (!channelId) return `Error: Could not find channel "${args.channel}"`;

        const result = await client.chat.postMessage({
          channel: channelId,
          text: formatForSlack(args.text),
          unfurl_links: false,
        });
        return `Message posted to #${args.channel} (ts: ${result.ts})`;
      }

      case "reply-thread": {
        if (!args.channel) return "Error: channel is required";
        if (!args.text) return "Error: text is required";
        if (!args.thread_ts) return "Error: thread_ts is required";
        const channelId = await resolveChannel(client, args.channel);
        if (!channelId) return `Error: Could not find channel "${args.channel}"`;

        const result = await client.chat.postMessage({
          channel: channelId,
          thread_ts: args.thread_ts,
          text: formatForSlack(args.text),
          unfurl_links: false,
        });
        return `Reply posted in thread (ts: ${result.ts})`;
      }

      case "read-channel": {
        if (!args.channel) return "Error: channel is required";
        const channelId = await resolveChannel(client, args.channel);
        if (!channelId) return `Error: Could not find channel "${args.channel}"`;

        const limit = parseInt(args.limit || "10", 10);
        const history = await client.conversations.history({
          channel: channelId,
          limit,
        });

        if (!history.messages || history.messages.length === 0) {
          return `No recent messages in #${args.channel}`;
        }

        const lines = history.messages.reverse().map((m) => {
          const time = m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString() : "?";
          const user = m.user || m.bot_id || "unknown";
          const text = (m.text || "").slice(0, 500);
          return `[${time}] <@${user}>: ${text}${m.thread_ts && m.thread_ts === m.ts ? ` (thread: ${m.ts})` : ""}`;
        });
        return lines.join("\n");
      }

      case "read-thread": {
        if (!args.channel) return "Error: channel is required";
        if (!args.thread_ts) return "Error: thread_ts is required";
        const channelId = await resolveChannel(client, args.channel);
        if (!channelId) return `Error: Could not find channel "${args.channel}"`;

        const limit = parseInt(args.limit || "20", 10);
        const replies = await client.conversations.replies({
          channel: channelId,
          ts: args.thread_ts,
          limit,
        });

        if (!replies.messages || replies.messages.length === 0) {
          return "No replies in this thread";
        }

        const lines = replies.messages.map((m) => {
          const time = m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString() : "?";
          const user = m.user || m.bot_id || "unknown";
          const text = (m.text || "").slice(0, 500);
          return `[${time}] <@${user}>: ${text}`;
        });
        return lines.join("\n");
      }

      case "react": {
        if (!args.channel) return "Error: channel is required";
        if (!args.emoji) return "Error: emoji is required";
        if (!args.message_ts) return "Error: message_ts is required";
        const channelId = await resolveChannel(client, args.channel);
        if (!channelId) return `Error: Could not find channel "${args.channel}"`;

        await client.reactions.add({
          channel: channelId,
          name: args.emoji,
          timestamp: args.message_ts,
        });
        return `Reacted with :${args.emoji}:`;
      }

      case "list-channels": {
        const result = await client.conversations.list({
          types: "public_channel,private_channel",
          limit: 100,
          exclude_archived: true,
        });

        if (!result.channels || result.channels.length === 0) {
          return "No channels found";
        }

        const lines = result.channels.map((c) => {
          const members = c.num_members ?? "?";
          const purpose = c.purpose?.value ? ` — ${c.purpose.value.slice(0, 80)}` : "";
          return `#${c.name} (${members} members${purpose})`;
        });
        return lines.join("\n");
      }

      case "dm-user": {
        // Accept user_id from many possible param names
        const userId = args.user_id || args.userId || args.channel || args.arg1;
        if (!userId) return "Error: user_id is required";
        if (!args.text) return "Error: text is required";

        // Open a DM conversation with the user
        const conv = await client.conversations.open({
          users: userId,
        });
        if (!conv.channel?.id) return "Error: Could not open DM conversation";

        const result = await client.chat.postMessage({
          channel: conv.channel.id,
          text: formatForSlack(args.text),
          unfurl_links: false,
        });
        return `DM sent (ts: ${result.ts})`;
      }

      default:
        return `Unknown slack command: "${command}". Available: post-message, read-channel, reply-thread, react, list-channels, dm-user, read-thread`;
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Slack error: ${msg}`;
  }
}
