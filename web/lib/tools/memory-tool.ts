import { readMemory, appendMemoryFact, replaceMemory } from "../memory";
import {
  searchMemories,
  insertMemory,
  listAllMemories,
  clearMemories,
} from "../vector-memory";
import { getAgentConfig } from "../agent-config";
import type { ToolModule } from "./types";

function useVector(agentId: string): boolean {
  try {
    return !!getAgentConfig(agentId).vectorMemory;
  } catch {
    return false;
  }
}

function formatVectorMemoryError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes("api key") ||
    lower.includes("permission denied") ||
    lower.includes("unauthorized") ||
    lower.includes(" 401") ||
    lower.includes("invalid api")
  ) {
    return `Memory failed (Gemini / auth): ${msg}. Set a valid GEMINI_API_KEY in web/.env.local for embeddings.`;
  }
  if (
    lower.includes("econnrefused") ||
    lower.includes("timeout") ||
    lower.includes("connect") ||
    lower.includes("relation \"_memory\"") ||
    lower.includes("does not exist")
  ) {
    return `Memory failed (database): ${msg}. Use CRM_DB_* like npm run db:exec and apply scripts/migrate-vector-memory.sql to the workspace schema.`;
  }
  return `Memory operation failed: ${msg}`;
}

const tool: ToolModule = {
  metadata: {
    id: "memory",
    displayName: "Agent Memory",
    category: "internal",
    description:
      "Persistent long-term memory for each agent. Stores facts, preferences, and context across conversations.",
    operations: ["read", "save_fact", "search", "replace"],
    requiresApproval: false,
  },

  declaration: {
    name: "memory",
    description:
      "Manage your long-term memory. Commands: 'read' (view all), 'save_fact' (add a fact, optionally with category), 'search' (find relevant memories by topic), 'replace' (rewrite all). Categories for save_fact: preference, person, project, decision, fact, general. You SHOULD proactively save important facts when you learn them (names, preferences, decisions, project context).",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "read, save_fact, search, or replace",
        },
        content: {
          type: "string",
          description:
            "For save_fact: the fact to remember. For replace: the full new memory content.",
        },
        category: {
          type: "string",
          description:
            "Category for save_fact: preference, person, project, decision, fact, general. Helps organize memory.",
        },
        query: {
          type: "string",
          description: "Search query for the 'search' command",
        },
      },
      required: ["command"],
    },
  },

  async execute(args, { agentId }) {
    const cmd = args.command;
    const isVector = useVector(agentId);

    if (cmd === "read") {
      if (!isVector) {
        const mem = readMemory(agentId);
        return mem || "(No memories saved yet)";
      }
      try {
        const memories = await listAllMemories(agentId);
        if (memories.length === 0) return "(No memories saved yet)";
        return memories.map((m) => `- [${m.category}] ${m.content}`).join("\n");
      } catch (e) {
        return formatVectorMemoryError(e);
      }
    }

    if (cmd === "save_fact") {
      if (!args.content) return "Error: content is required for save_fact";
      if (!isVector) {
        appendMemoryFact(agentId, args.content);
        return `Saved to memory: ${args.content}`;
      }
      try {
        const mem = await insertMemory(agentId, args.content, {
          category: args.category,
        });
        return `Saved to memory [${mem.category}]: ${args.content}`;
      } catch (e) {
        return formatVectorMemoryError(e);
      }
    }

    if (cmd === "search") {
      if (!isVector) {
        const mem = readMemory(agentId);
        return mem || "(No memories saved yet)";
      }
      const q = args.query || args.content || "";
      if (!q) return "Error: query or content is required for search";
      try {
        const results = await searchMemories(agentId, q);
        if (results.length === 0) return "No relevant memories found.";
        return results
          .map(
            (m) =>
              `- [${m.category}] ${m.content} (relevance: ${((m.similarity ?? 0) * 100).toFixed(0)}%)`
          )
          .join("\n");
      } catch (e) {
        return formatVectorMemoryError(e);
      }
    }

    if (cmd === "replace") {
      if (!isVector) {
        replaceMemory(agentId, args.content || "");
        return "Memory replaced successfully";
      }
      try {
        await clearMemories(agentId);
        if (args.content) {
          const lines = args.content
            .split("\n")
            .map((l) => l.replace(/^[-*]\s*/, "").trim())
            .filter((l) => l.length > 0);
          for (const line of lines) {
            await insertMemory(agentId, line, { source: "tool" });
          }
        }
        return "Memory replaced successfully (re-embedded)";
      } catch (e) {
        return formatVectorMemoryError(e);
      }
    }

    return "Unknown memory command. Use: read, save_fact, search, replace";
  },
};

export default tool;
