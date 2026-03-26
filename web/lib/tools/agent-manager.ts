import { execFileSync } from "child_process";
import { join } from "path";
import type { ToolModule } from "./types";
import { TOOL_SCRIPTS_PATH, getToolEnv } from "./shared";

const tool: ToolModule = {
  metadata: {
    id: "agent_manager",
    displayName: "Agent Manager",
    category: "meta",
    description:
      "Provision new agents, read/update system prompts, check status, and restart services. Used by Friday on-demand.",
    externalSystem: "Server (systemd / PM2)",
    operations: [
      "list-agents",
      "get-agent-config",
      "read-prompt",
      "update-prompt",
      "create-agent",
      "restart-agent",
      "agent-status",
    ],
    requiresApproval: false,
  },

  declaration: {
    name: "agent_manager",
    description:
      "Manage agents in the Strattegys Command Central system. Create new agents, read/update system prompts, check agent status, and restart services. Use create-agent to provision server directories and system prompt for a new agent. After create-agent, the agent must still be registered in the codebase configs (agent-config.ts, config.ts) and deployed — tell the user to register them in the codebase (Cursor) and deploy via git. Available commands: list-agents, get-agent-config, read-prompt, update-prompt, create-agent, restart-agent, agent-status.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "Command: list-agents (no args), get-agent-config <agent_id>, read-prompt <agent_id>, update-prompt <agent_id> <prompt_text>, create-agent <agent_id> <prompt_text>, restart-agent <agent_id>, agent-status <agent_id>",
        },
        arg1: {
          type: "string",
          description: "First argument: agent_id (e.g. 'scout', 'nova')",
        },
        arg2: {
          type: "string",
          description:
            "Second argument: system prompt text (for create-agent or update-prompt)",
        },
      },
      required: ["command"],
    },
  },

  async execute(args) {
    const cmdArgs = [args.command, args.arg1, args.arg2].filter(Boolean);
    return execFileSync(join(TOOL_SCRIPTS_PATH, "agent_manager.sh"), cmdArgs, {
      timeout: 30000,
      env: getToolEnv(),
      encoding: "utf-8",
    });
  },
};

export default tool;
