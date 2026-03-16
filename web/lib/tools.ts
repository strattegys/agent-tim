import { execFileSync } from "child_process";
import { join } from "path";

const TOOL_SCRIPTS_PATH =
  process.env.TOOL_SCRIPTS_PATH || join(process.cwd(), "..", ".nanobot", "tools");
const TOOL_TIMEOUT = 15000;
const LINKEDIN_TIMEOUT = 60000;

export const toolDeclarations = [
  {
    name: "twenty_crm",
    description:
      "Execute a Twenty CRM operation. IMPORTANT: To search for a person, use command='search-contacts' (not search-people). Available commands: list-contacts, search-contacts, get-contact, create-contact, update-contact, write-note, list-campaigns, get-campaign, create-campaign, add-to-campaign, remove-from-campaign, get-campaign-context, list-campaign-members.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "The command to run. Use 'search-contacts' to find people by name. Other commands: list-contacts, get-contact, create-contact, update-contact, write-note, list-campaigns, get-campaign, add-to-campaign, remove-from-campaign, get-campaign-context, list-campaign-members.",
        },
        arg1: {
          type: "string",
          description: "First argument (query string, ID, or JSON payload)",
        },
        arg2: {
          type: "string",
          description: "Second argument (JSON payload for update operations)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "linkedin",
    description: "Execute a LinkedIn operation via ConnectSafely API. IMPORTANT: ONLY use send-message or send-connection when the user explicitly says 'send it now'. NEVER send messages without explicit approval.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "The command: fetch-profile, send-message, recent-messages, send-connection, account-info",
        },
        arg1: {
          type: "string",
          description: "First argument (profile vanity slug, e.g. 'rajat-gupta-104391')",
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
            "ISO 8601 datetime when to send, e.g. '2026-03-17T10:07:00-04:00'. Use the user's timezone (US Eastern).",
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

export function executeTool(
  name: string,
  args: Record<string, string>
): string {
  try {
    if (name === "twenty_crm") {
      const cmdArgs = [args.command, args.arg1, args.arg2].filter(Boolean);
      return execFileSync(join(TOOL_SCRIPTS_PATH, "twenty_crm.sh"), cmdArgs, {
        timeout: TOOL_TIMEOUT,
        env: getToolEnv(),
        encoding: "utf-8",
      });
    }

    if (name === "linkedin") {
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

    return `Unknown tool: ${name}`;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Tool error: ${msg}`;
  }
}
