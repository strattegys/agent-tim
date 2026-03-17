import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { chat } from "../../../web/lib/gemini";
import { getAgentConfig } from "../../../web/lib/agent-config";
import { dirname } from "path";
import { formatForSlack } from "../format.js";

/**
 * Strip Slack user/bot mentions from message text.
 * Slack sends mentions as <@U12345> — remove them to get clean user input.
 */
function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

/**
 * Build a Slack session file path for an agent.
 * All Slack interactions (channels + DMs) share one session per agent,
 * keeping context when conversations move between channels/DMs.
 * Separate from web/telegram sessions to prevent cross-platform bleed.
 */
function getSlackSessionFile(agentId: string): string {
  const config = getAgentConfig(agentId);
  const sessionDir = dirname(config.sessionFile);
  return `${sessionDir}/slack_${agentId}.jsonl`;
}

/**
 * Fetch thread context from Slack and format it as a preamble for the user message.
 * This gives the agent full awareness of what the thread is about when the user
 * replies in a thread (e.g., replying to a heartbeat finding or a channel post).
 */
async function getThreadContext(
  client: WebClient,
  channel: string,
  threadTs: string,
  currentMessageTs: string
): Promise<string> {
  try {
    const replies = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit: 20,
    });

    if (!replies.messages || replies.messages.length <= 1) return "";

    // Filter out the current message, "Thinking..." placeholders, and bot error messages
    const relevant = replies.messages.filter((m) => {
      if (m.ts === currentMessageTs) return false;
      const text = m.text || "";
      if (text.includes("Thinking...")) return false;
      // Skip bot messages about errors/failures — they poison future attempts
      if (m.bot_id && /error|can't|cannot|trouble|glitch|unfortunately|having.+issue/i.test(text)) return false;
      return true;
    });

    if (relevant.length === 0) return "";

    // Include root message (the topic) + last few user messages for context
    const root = relevant[0];
    const recent = relevant.slice(-3);
    const included = [root, ...recent.filter((m) => m.ts !== root.ts)];

    const contextLines = included.map((m) => {
      const who = m.bot_id ? "You (bot)" : "User";
      return `${who}: ${(m.text || "").slice(0, 1000)}`;
    });

    return `[Thread context — the user is replying to this thread]\n${contextLines.join("\n")}\n[End thread context]\n\n`;
  } catch {
    return "";
  }
}

/**
 * Register message handlers for a single agent's Bolt app.
 */
export function registerMessageHandlers(app: App, agentId: string): void {
  // Log all incoming events for debugging
  app.use(async ({ body, next }) => {
    console.log(`[${agentId}] Event received:`, JSON.stringify(body).slice(0, 200));
    await next();
  });

  // Handle @mentions in channels
  app.event("app_mention", async ({ event, client, logger }) => {
    const userMessage = stripMentions(event.text);
    if (!userMessage) return;

    try {
      // Silent thinking indicator (ephemeral = no push notification)
      await client.chat.postEphemeral({
        channel: event.channel,
        user: event.user,
        thread_ts: event.thread_ts || event.ts,
        text: ":hourglass_flowing_sand: Thinking...",
      });

      // If this is a thread reply, fetch thread context so the agent knows what it's about
      let fullMessage = userMessage;
      if (event.thread_ts) {
        const threadContext = await getThreadContext(client, event.channel, event.thread_ts, event.ts);
        fullMessage = threadContext + userMessage;
      }

      // Include user's Slack ID so agent can DM them if needed
      const userContext = `[Slack user ID: ${event.user}]\n`;
      fullMessage = userContext + fullMessage;

      // Call the shared backend with Slack session
      // Save only the clean user message (no thread preamble — it's re-fetched each time)
      const sessionFile = getSlackSessionFile(agentId);
      const reply = await chat(agentId, fullMessage, { sessionFile, saveMessage: userMessage });

      // Post actual reply (triggers push notification)
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts,
        text: formatForSlack(reply),
        unfurl_links: false,
      });
    } catch (error) {
      logger.error(`[${agentId}] Error handling mention:`, error);
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts,
        text: `:x: Sorry, I hit an error. Please try again.`,
      });
    }
  });

  // Handle direct messages
  app.event("message", async ({ event, client, logger }) => {
    // Only handle DMs (im channel type), skip bot messages and subtypes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = event as any;
    if (msg.channel_type !== "im") return;
    if (msg.bot_id || msg.subtype) return;

    const text = (msg.text as string) || "";
    if (!text.trim()) return;

    try {
      // Silent thinking indicator (ephemeral = no push notification)
      await client.chat.postEphemeral({
        channel: msg.channel as string,
        user: msg.user as string,
        thread_ts: msg.thread_ts,
        text: ":hourglass_flowing_sand: Thinking...",
      });

      // If this is a thread reply, fetch thread context
      const cleanMessage = text.trim();
      let fullMessage = cleanMessage;
      if (msg.thread_ts) {
        const threadContext = await getThreadContext(client, msg.channel as string, msg.thread_ts as string, msg.ts as string);
        fullMessage = threadContext + fullMessage;
      }

      // Include user's Slack ID so agent can DM them if needed
      const userContext = `[Slack user ID: ${msg.user}]\n`;
      fullMessage = userContext + fullMessage;

      // Call the shared backend with Slack session
      // Save only the clean user message (no thread/user preamble — re-fetched each time)
      const sessionFile = getSlackSessionFile(agentId);
      const reply = await chat(agentId, fullMessage, { sessionFile, saveMessage: cleanMessage });

      // Post actual reply (triggers push notification)
      await client.chat.postMessage({
        channel: msg.channel as string,
        text: formatForSlack(reply),
        unfurl_links: false,
      });
    } catch (error) {
      logger.error(`[${agentId}] Error handling DM:`, error);
      await client.chat.postMessage({
        channel: msg.channel as string,
        text: `:x: Sorry, I hit an error. Please try again.`,
      });
    }
  });
}
