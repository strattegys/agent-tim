import { readFileSync } from "fs";
import { readMemory } from "./memory";
import { searchMemories, listAllMemories } from "./vector-memory";
import { getAgentConfig, isChatEphemeralAgent } from "./agent-config";

const promptCache = new Map<string, string>();

export function clearPromptCache(path?: string) {
  if (path) {
    promptCache.delete(path);
  } else {
    promptCache.clear();
  }
}

/**
 * Build the system prompt for an agent.
 * Now async — for vector-memory agents, embeds the user message and retrieves
 * the top-K relevant memories via cosine similarity.
 */
export async function getSystemPrompt(
  promptFile?: string,
  agentId?: string,
  userMessage?: string
): Promise<string> {
  const path = promptFile || "/root/.nanobot/system-prompt.md";

  let content: string;
  const cached = promptCache.get(path);
  if (cached) {
    content = cached;
  } else {
    try {
      content = readFileSync(path, "utf-8");
      promptCache.set(path, content);
    } catch {
      content =
        "You are a helpful AI assistant. Be friendly, direct, and efficient.";
      promptCache.set(path, content);
    }
  }

  // Inject current date/time so the model always knows the real date
  const now = new Date();
  const pacific = now.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "full",
    timeStyle: "short",
  });

  // Inject memory section
  let memorySection = "";
  if (agentId) {
    if (isChatEphemeralAgent(agentId)) {
      memorySection = `\n\n## Local ephemeral session\nLong-term and vector memory are off for local testing. Chat and memory-tool files stay under .dev-ephemeral-chat/${agentId}/ on this machine only — delete that folder to reset.`;
    } else {
    const isVector = (() => {
      try {
        return !!getAgentConfig(agentId).vectorMemory;
      } catch {
        return false;
      }
    })();

    if (isVector) {
      // Vector RAG: retrieve relevant memories based on user message
      try {
        let memories;
        if (userMessage) {
          memories = await searchMemories(agentId, userMessage, { topK: 15 });
        } else {
          memories = (await listAllMemories(agentId)).slice(0, 15);
        }

        if (memories.length > 0) {
          const memLines = memories
            .map((m) => `- [${m.category}] ${m.content}`)
            .join("\n");
          memorySection = `\n\n## Relevant Memories\nThese memories are retrieved based on relevance to the current conversation. Use them for personalized, context-aware responses. You can save new facts with the memory tool (include a category: preference, person, project, decision, fact, general).\n${memLines}`;
        } else {
          memorySection = `\n\n## Relevant Memories\nNo relevant memories found for this topic. Use the memory tool to save important facts as you learn them.`;
        }
      } catch (err) {
        console.error("[system-prompt] Vector memory retrieval failed:", err);
        memorySection = `\n\n## Relevant Memories\nMemory retrieval temporarily unavailable. Use the memory tool to save important facts.`;
      }
    } else {
      // File-based memory (original path for non-vector agents)
      const memoryContent = readMemory(agentId);
      if (memoryContent) {
        memorySection = `\n\n## Long-term Memory\nThese are facts you have saved from previous conversations. Use them to provide personalized, context-aware responses:\n${memoryContent}`;
      } else {
        memorySection = `\n\n## Long-term Memory\nNo memories saved yet. Use the memory tool to save important facts as you learn them.`;
      }
    }
    }
  }

  // Tool enforcement block — injected for all agents with tools
  let toolEnforcement = "";
  if (agentId) {
    try {
      const agentConfig = getAgentConfig(agentId);
      if (agentConfig.tools.length > 0) {
        toolEnforcement = `

## MANDATORY: Tool Execution Enforcement
You have these tools available: ${agentConfig.tools.join(", ")}

ABSOLUTE RULES — violations will cause data loss for the user:
1. When the user asks you to ADD, CREATE, DELETE, UPDATE, MARK DONE, or CHANGE anything in reminders, punch list, or notes — you MUST respond with a function call. NEVER respond with only text.
2. If you say "Done!" or "I've added/deleted/updated that" WITHOUT having made a function call in this turn, THE ACTION DID NOT HAPPEN and the user will be misled.
3. After executing a tool, CHECK the return value. Only confirm success if the return contains a confirmation (ID, number, "success"). If it contains "Error", tell the user.
4. NEVER claim you performed an action based on memory of a previous conversation. Each request requires a NEW tool call.
5. If you are unsure whether a tool call succeeded, call the "list" command to verify.`;
      }
    } catch {
      // agent not found — skip
    }
  }

  return `${content}\n\nCurrent date and time (US Pacific): ${pacific}${memorySection}${toolEnforcement}`;
}
