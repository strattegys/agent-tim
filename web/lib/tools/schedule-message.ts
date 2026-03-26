import { execFileSync } from "child_process";
import { join } from "path";
import type { ToolModule } from "./types";
import { TOOL_SCRIPTS_PATH, TOOL_TIMEOUT, getToolEnv, hasUserApproval } from "./shared";

const tool: ToolModule = {
  metadata: {
    id: "schedule_message",
    displayName: "Message Scheduler",
    category: "external",
    description:
      "Queue LinkedIn messages for future delivery. Cron processes the queue every minute and sends due messages.",
    externalSystem: "LinkedIn via Unipile (cron queue)",
    operations: ["schedule", "list", "cancel"],
    requiresApproval: true,
  },

  declaration: {
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
          description:
            "LinkedIn vanity slug of the recipient (for schedule command)",
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

  async execute(args, { lastUserMessage, agentId }) {
    const cmd = args.command;

    if (agentId === "tim") {
      return "BLOCKED: Tim does not schedule or send LinkedIn messages from chat. Use the work queue and Submit when ready.";
    }

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
  },
};

export default tool;
