import { execFileSync } from "child_process";
import { join } from "path";
import type { ToolModule } from "./types";
import { TOOL_SCRIPTS_PATH, LINKEDIN_TIMEOUT, getToolEnv, hasUserApproval } from "./shared";

const tool: ToolModule = {
  metadata: {
    id: "linkedin",
    displayName: "LinkedIn Messaging",
    category: "external",
    description:
      "Fetch profiles, send messages, check connections, and read conversations. Syncs inbound messages to CRM every 15 min.",
    externalSystem: "Unipile API → LinkedIn",
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
      "Execute a LinkedIn operation via Unipile (this tool only — never Python/pseudocode). " +
      "Valid commands: fetch-profile, send-message, recent-messages, send-connection, account-info, get-chat-messages. " +
      "There is NO search_profile or linkedin.foo() API — use twenty_crm search-contacts to find someone, read their LinkedIn URL, then fetch-profile or send-message. " +
      "Invoke this tool with parameters command, arg1 (profile id / URL / slug), arg2 (message body for send-message). " +
      "send-message and send-connection require explicit user approval in the same turn (see system prompt). " +
      "For send-message, prefer ACoAAA provider ID from CRM linkedinLink; full URLs and vanity slugs often work.",
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

  async execute(args, { lastUserMessage, agentId }) {
    const dangerousCmds = ["send-message", "send-connection"];
    if (dangerousCmds.includes(args.command) && agentId === "tim") {
      return "BLOCKED: Tim no longer sends LinkedIn messages from chat. Govind must use the work queue: edit the draft in the right panel, then click Submit. You can help by updating the draft via workflow_items update-workflow-artifact.";
    }
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
