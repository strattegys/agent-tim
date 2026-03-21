import { execFileSync } from "child_process";
import { join } from "path";
import type { ToolModule } from "./types";
import { TOOL_SCRIPTS_PATH, LINKEDIN_TIMEOUT, getToolEnv, hasUserApproval } from "./shared";

const tool: ToolModule = {
  metadata: {
    id: "linkedin",
    displayName: "LinkedIn",
    category: "external",
    description:
      "Fetch profiles, send messages, check connections, and read conversations via the Unipile LinkedIn API",
    externalSystem: "Unipile API (api32.unipile.com)",
    operations: [
      "fetch-profile",
      "send-message",
      "recent-messages",
      "send-connection",
      "account-info",
      "get-chat-messages",
    ],
    requiresApproval: true,
  },

  declaration: {
    name: "linkedin",
    description:
      "Execute a LinkedIn operation via Unipile API. IMPORTANT: ONLY use send-message or send-connection when the user explicitly says 'send it now'. NEVER send messages without explicit approval. For send-message, use the ACoAAA provider ID from the contact's LinkedIn URL in the CRM — vanity slugs may not work for all profiles.",
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
          description:
            "First argument: LinkedIn provider ID (ACoAAA...), vanity slug (e.g. 'rajat-gupta-104391'), or full LinkedIn URL. For send-message, prefer the ACoAAA ID from the CRM contact's linkedinLink.",
        },
        arg2: {
          type: "string",
          description:
            "Second argument (message text for send-message, or connection note for send-connection)",
        },
      },
      required: ["command"],
    },
  },

  async execute(args, { lastUserMessage }) {
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
  },
};

export default tool;
