import { readMemory, appendMemoryFact, replaceMemory } from "../memory";
import type { ToolModule } from "./types";

const tool: ToolModule = {
  metadata: {
    id: "memory",
    displayName: "Agent Memory",
    category: "internal",
    description:
      "Persistent long-term memory for each agent. Stores facts, preferences, and context across conversations.",
    operations: ["read", "save_fact", "replace"],
    requiresApproval: false,
  },

  declaration: {
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

  async execute(args, { agentId }) {
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
      replaceMemory(agentId, args.content || "");
      return "Memory replaced successfully";
    }

    return "Unknown memory command. Use: read, save_fact, replace";
  },
};

export default tool;
