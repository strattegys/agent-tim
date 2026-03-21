import { createTask } from "../tasks";
import type { ToolModule } from "./types";

const tool: ToolModule = {
  metadata: {
    id: "delegate_task",
    displayName: "Task Delegation",
    category: "meta",
    description:
      "Hand off work to specialist agents. Sync mode waits for results; async queues for Scout's heartbeat to process.",
    operations: ["sync", "async"],
    requiresApproval: false,
  },

  declaration: {
    name: "delegate_task",
    description:
      "Delegate a task to another agent. Use this when you need research, analysis, or other work done by a specialist agent. The 'scout' agent can do web research, company intel, and contact discovery. Use urgency='sync' to wait for the result immediately, or 'async' to queue it for background processing.",
    parameters: {
      type: "object" as const,
      properties: {
        agent: {
          type: "string",
          description: "Target agent ID to delegate to (e.g., 'scout')",
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

  async execute(args, { agentId }) {
    const targetAgent = args.agent;
    const taskDesc = args.task;
    const urgency = args.urgency as "sync" | "async";

    if (!targetAgent || !taskDesc) {
      return "Error: agent and task are required for delegate_task";
    }

    if (urgency === "sync") {
      // Dynamic import to avoid circular dependency with gemini.ts
      const { autonomousChat } = await import("../gemini");
      const result = await autonomousChat(targetAgent, taskDesc, {
        fromAgent: agentId,
      });
      return result || "The agent completed the task but returned no response.";
    } else {
      const taskId = createTask(agentId, targetAgent, taskDesc, "async");
      return `Task queued for ${targetAgent} agent (ID: ${taskId}). The result will be available on your next check-in.`;
    }
  },
};

export default tool;
