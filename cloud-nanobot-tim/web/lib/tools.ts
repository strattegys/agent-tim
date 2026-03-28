import { execFileSync } from "child_process";
import { join } from "path";

const TOOL_SCRIPTS_PATH =
  process.env.TOOL_SCRIPTS_PATH || join(process.cwd(), "..", ".nanobot", "tools");
const TOOL_TIMEOUT = 15000;

export const toolDeclarations = [
  {
    name: "twenty_crm",
    description:
      "Execute a Twenty CRM operation. Supports contacts, companies, opportunities, tasks, work items, notes, calendar events, messages, activities, attachments, favorites, workflows.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "The command to run, e.g. 'list-contacts', 'search-contacts', 'create-contact', 'get-contact', 'update-contact', 'delete-contact', etc.",
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
    description: "Execute a LinkedIn operation via ConnectSafely API.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "The command: lookup-profile, search-profile, send-message, recent-messages, send-connection, account-info",
        },
        arg1: {
          type: "string",
          description: "First argument (URL, name, JSON payload, or limit)",
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
      const cmdArgs = [args.command, args.arg1].filter(Boolean);
      return execFileSync(join(TOOL_SCRIPTS_PATH, "linkedin.sh"), cmdArgs, {
        timeout: TOOL_TIMEOUT,
        env: getToolEnv(),
        encoding: "utf-8",
      });
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
