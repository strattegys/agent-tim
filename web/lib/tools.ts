import { execFileSync } from "child_process";
import { join } from "path";
import { readMemory, appendMemoryFact, replaceMemory } from "./memory";
import { createTask } from "./tasks";

const TOOL_SCRIPTS_PATH =
  process.env.TOOL_SCRIPTS_PATH || join(process.cwd(), "..", ".nanobot", "tools");
const TOOL_TIMEOUT = 15000;
const LINKEDIN_TIMEOUT = 60000;

// Optional callback for delegation visibility (set by Slack gateway)
export type DelegationCallback = (from: string, to: string, task: string, result: string) => void;
let delegationCallback: DelegationCallback | undefined;
export function setDelegationCallback(cb: DelegationCallback) {
  delegationCallback = cb;
}

// Optional callback for Slack operations (set by Slack gateway)
export type SlackExecutor = (agentId: string, command: string, args: Record<string, string>) => Promise<string>;
let slackExecutor: SlackExecutor | undefined;
export function setSlackExecutor(executor: SlackExecutor) {
  slackExecutor = executor;
}

export const toolDeclarations = [
  {
    name: "twenty_crm",
    description:
      "Execute a Twenty CRM operation. IMPORTANT: To search for a person, use command='search-contacts' (not search-people). For create-contact, use flat JSON fields like {\"firstName\":\"John\",\"lastName\":\"Doe\",\"jobTitle\":\"CEO\",\"email\":\"j@co.com\",\"linkedinUrl\":\"https://linkedin.com/in/slug\",\"companyId\":\"uuid\"} — the tool auto-wraps into Twenty's composite format. For write-note, arg1=title, arg2=markdown content (supports full markdown). Campaign commands use a dedicated Campaign object with inline spec field. Available commands: list-contacts, search-contacts, get-contact, create-contact, update-contact, write-note, search-companies, create-company, get-company, list-campaigns, get-campaign, get-campaign-spec, update-campaign-spec, create-campaign, add-to-campaign, remove-from-campaign, get-campaign-context, list-campaign-members.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "The command to run. Key commands: search-contacts (find people by name), create-contact (accepts flat JSON with firstName, lastName, jobTitle, email, linkedinUrl, companyId), write-note (arg1=title, arg2=content, optionally arg1=title arg2=content for linked notes use the format: 'title' 'content' 'targetType' 'targetId'), search-companies, create-company, list-campaigns, get-campaign, get-campaign-spec (read spec), update-campaign-spec (arg1=campaign_id, arg2=new_spec), create-campaign (arg1=name, arg2=spec), add-to-campaign.",
        },
        arg1: {
          type: "string",
          description: "First argument: query string for search, JSON payload for create-contact/create-company, title for write-note, or record ID for get/update",
        },
        arg2: {
          type: "string",
          description: "Second argument: JSON payload for update, markdown content for write-note",
        },
        arg3: {
          type: "string",
          description: "Third argument: for write-note linked to a record, the target type (person or company)",
        },
        arg4: {
          type: "string",
          description: "Fourth argument: for write-note linked to a record, the target record ID",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "linkedin",
    description: "Execute a LinkedIn operation via Unipile API. IMPORTANT: ONLY use send-message or send-connection when the user explicitly says 'send it now'. NEVER send messages without explicit approval. For send-message, use the ACoAAA provider ID from the contact's LinkedIn URL in the CRM — vanity slugs may not work for all profiles.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "The command: fetch-profile, send-message, recent-messages, send-connection, account-info, get-chat-messages",
        },
        arg1: {
          type: "string",
          description: "First argument: LinkedIn provider ID (ACoAAA...), vanity slug (e.g. 'rajat-gupta-104391'), or full LinkedIn URL. For send-message, prefer the ACoAAA ID from the CRM contact's linkedinLink.",
        },
        arg2: {
          type: "string",
          description: "Second argument (message text for send-message, or connection note for send-connection)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "schedule_message",
    description:
      "Schedule a LinkedIn message to be sent at a future time. IMPORTANT: ONLY use this tool when the user explicitly says 'schedule it now' or 'send it now'. NEVER schedule or send a message without explicit user approval. Commands: schedule, list, cancel.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "The command: 'schedule' to queue a message, 'list' to show pending messages, 'cancel' to cancel a scheduled message.",
        },
        recipient_slug: {
          type: "string",
          description: "LinkedIn vanity slug of the recipient (for schedule command)",
        },
        recipient_name: {
          type: "string",
          description: "Display name of the recipient (for schedule command)",
        },
        message: {
          type: "string",
          description: "The message text to send (for schedule command)",
        },
        send_at: {
          type: "string",
          description:
            "ISO 8601 datetime when to send, e.g. '2026-03-17T10:07:00-07:00'. ALWAYS use US Pacific time (America/Los_Angeles).",
        },
        message_id: {
          type: "string",
          description: "Message ID to cancel (for cancel command)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "web_search",
    description: "Search the web using Brave Search API.",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory",
    description:
      "Manage your long-term memory. Use this to remember important facts, user preferences, and context across conversations. Commands: 'read' to view current memory, 'save_fact' to add a single fact, 'replace' to rewrite entire memory. You SHOULD proactively save important facts when you learn them (names, preferences, decisions, project context).",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "The command: 'read' to see current memory, 'save_fact' to add a fact, 'replace' to rewrite all memory",
        },
        content: {
          type: "string",
          description:
            "For save_fact: the fact to remember. For replace: the full new memory content.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "slack",
    description:
      "Interact with Slack workspace. You can post messages to channels, read channel history, reply in threads, react to messages, list channels, DM users, and schedule messages. You are IN Slack — when a user talks to you in a channel or DM, your response is already posted there. Use this tool when you need to proactively reach out to a DIFFERENT channel, start a new thread, read what's happening elsewhere, or schedule a future message.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "The command: 'post-message' (post to a channel), 'read-channel' (read recent messages), 'reply-thread' (reply in a thread), 'react' (add emoji reaction), 'list-channels' (list workspace channels), 'dm-user' (DM a specific user), 'read-thread' (read thread replies), 'set-reminder' (schedule a message to be posted at a future time — requires channel and unix timestamp), 'list-reminders' (list scheduled messages in a channel)",
        },
        channel: {
          type: "string",
          description:
            "Channel name (without #) or channel ID. For named channels use: alerts, ops, research, general, etc. For DMs, use the user's Slack ID.",
        },
        text: {
          type: "string",
          description: "Message text (for post-message, reply-thread, dm-user)",
        },
        thread_ts: {
          type: "string",
          description: "Thread timestamp (for reply-thread, read-thread, react)",
        },
        emoji: {
          type: "string",
          description: "Emoji name without colons, e.g. 'thumbsup' (for react)",
        },
        message_ts: {
          type: "string",
          description: "Message timestamp to react to (for react)",
        },
        limit: {
          type: "string",
          description: "Number of messages to read (for read-channel, read-thread). Default: 10",
        },
        user_id: {
          type: "string",
          description: "Slack user ID (for dm-user)",
        },
        time: {
          type: "string",
          description: "When to post the scheduled message (for set-reminder). Use ISO 8601 format with timezone, e.g. '2026-03-19T10:00:00-07:00' for 10am Pacific. ALWAYS include the timezone offset.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "delegate_task",
    description:
      "Delegate a task to another agent. Use this when you need research, analysis, or other work done by a specialist agent. The 'scout' agent can do web research, company intel, and contact discovery. Use urgency='sync' to wait for the result immediately, or 'async' to queue it for background processing.",
    parameters: {
      type: "object" as const,
      properties: {
        agent: {
          type: "string",
          description:
            "Target agent ID to delegate to (e.g., 'scout')",
        },
        task: {
          type: "string",
          description:
            "Detailed task description. Be specific about what information you need.",
        },
        urgency: {
          type: "string",
          description:
            "'sync' to wait for the result now (use when user is waiting), or 'async' to queue for background processing (use for non-urgent research)",
        },
      },
      required: ["agent", "task", "urgency"],
    },
  },
];

function getToolEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TWENTY_CRM_API_KEY: process.env.TWENTY_CRM_API_KEY,
    TWENTY_CRM_URL: process.env.TWENTY_CRM_URL || "http://localhost:3000",
    CONNECTSAFELY_API_KEY: process.env.CONNECTSAFELY_API_KEY,
    CONNECTSAFELY_ACCOUNT_ID: process.env.CONNECTSAFELY_ACCOUNT_ID,
    BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,
  };
}

export const APPROVAL_PHRASES = [
  "send it now",
  "schedule it now",
  "go ahead and send",
  "go ahead and schedule",
];

function hasUserApproval(lastUserMessage: string): boolean {
  const lower = lastUserMessage.toLowerCase();
  return APPROVAL_PHRASES.some((phrase) => lower.includes(phrase));
}

export async function executeTool(
  name: string,
  args: Record<string, string>,
  lastUserMessage = "",
  agentId = "tim"
): Promise<string> {
  try {
    if (name === "memory") {
      const cmd = args.command;
      if (cmd === "read") {
        const mem = readMemory(agentId);
        return mem || "(No memories saved yet)";
      }
      if (cmd === "save_fact") {
        if (!args.content) return "Error: content is required for save_fact";
        appendMemoryFact(agentId, args.content);
        return `Saved to memory: ${args.content}`;
      }
      if (cmd === "replace") {
        if (!args.content) return "Error: content is required for replace";
        replaceMemory(agentId, args.content);
        return "Memory replaced successfully";
      }
      return "Unknown memory command. Use: read, save_fact, replace";
    }

    if (name === "twenty_crm") {
      const cmdArgs = [args.command, args.arg1, args.arg2, args.arg3, args.arg4].filter(Boolean);
      return execFileSync(join(TOOL_SCRIPTS_PATH, "twenty_crm.sh"), cmdArgs, {
        timeout: TOOL_TIMEOUT,
        env: getToolEnv(),
        encoding: "utf-8",
      });
    }

    if (name === "linkedin") {
      const dangerousCmds = ["send-message", "send-connection"];
      if (dangerousCmds.includes(args.command) && !hasUserApproval(lastUserMessage)) {
        return "BLOCKED: Cannot send messages without explicit user approval. The user must say 'send it now' before you can send. Present your draft and wait for approval.";
      }
      const cmdArgs = [args.command, args.arg1, args.arg2].filter(Boolean);
      return execFileSync(join(TOOL_SCRIPTS_PATH, "linkedin.sh"), cmdArgs, {
        timeout: LINKEDIN_TIMEOUT,
        env: getToolEnv(),
        encoding: "utf-8",
      });
    }

    if (name === "schedule_message") {
      const cmd = args.command;
      if (cmd === "schedule") {
        if (!hasUserApproval(lastUserMessage)) {
          return "BLOCKED: Cannot schedule messages without explicit user approval. The user must say 'schedule it now' before you can schedule. Present your draft and wait for approval.";
        }
        const cmdArgs = [
          "schedule",
          args.recipient_slug,
          args.recipient_name,
          args.message,
          args.send_at,
        ].filter(Boolean);
        return execFileSync(
          "python3",
          [join(TOOL_SCRIPTS_PATH, "scheduled_messages.py"), ...cmdArgs],
          { timeout: TOOL_TIMEOUT, env: getToolEnv(), encoding: "utf-8" }
        );
      }
      if (cmd === "list") {
        return execFileSync(
          "python3",
          [join(TOOL_SCRIPTS_PATH, "scheduled_messages.py"), "list"],
          { timeout: TOOL_TIMEOUT, env: getToolEnv(), encoding: "utf-8" }
        );
      }
      if (cmd === "cancel") {
        return execFileSync(
          "python3",
          [join(TOOL_SCRIPTS_PATH, "scheduled_messages.py"), "cancel", args.message_id],
          { timeout: TOOL_TIMEOUT, env: getToolEnv(), encoding: "utf-8" }
        );
      }
      return "Unknown schedule_message command. Use: schedule, list, cancel";
    }

    if (name === "web_search") {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY;
      if (!apiKey) return "Web search not configured";

      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args.query)}&count=5`;
      // Use sync fetch via execFileSync curl
      const result = execFileSync(
        "curl",
        ["-s", "-H", `X-Subscription-Token: ${apiKey}`, url],
        { timeout: TOOL_TIMEOUT, encoding: "utf-8" }
      );
      return result;
    }

    if (name === "slack") {
      if (!slackExecutor) {
        return "Slack is not available in this context. Slack tools only work when running through the Slack gateway.";
      }
      return await slackExecutor(agentId, args.command, args);
    }

    if (name === "delegate_task") {
      const targetAgent = args.agent;
      const taskDesc = args.task;
      const urgency = args.urgency as "sync" | "async";

      if (!targetAgent || !taskDesc) {
        return "Error: agent and task are required for delegate_task";
      }

      if (urgency === "sync") {
        // Synchronous: call the target agent directly and return the result
        // Dynamic import to avoid circular dependency with gemini.ts
        const { autonomousChat } = await import("./gemini");
        const result = await autonomousChat(targetAgent, taskDesc, { fromAgent: agentId });
        // Notify Slack (or other transport) about the delegation
        delegationCallback?.(agentId, targetAgent, taskDesc, result || "(no response)");
        return result || "The agent completed the task but returned no response.";
      } else {
        // Async: queue the task for the target agent's heartbeat to pick up
        const taskId = createTask(agentId, targetAgent, taskDesc, "async");
        return `Task queued for ${targetAgent} agent (ID: ${taskId}). The result will be available on your next check-in.`;
      }
    }

    return `Unknown tool: ${name}`;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Tool error: ${msg}`;
  }
}
