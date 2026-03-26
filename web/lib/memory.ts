import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { getAgentConfig } from "./agent-config";

/**
 * Agent Memory System
 *
 * Each agent has a memory directory containing:
 * - MEMORY.md: Long-term facts (preferences, context, learned info)
 * - YYYY-MM-DD.md: Daily conversation summaries
 *
 * Memory is injected into the system prompt so agents recall facts across sessions.
 * Auto-consolidation summarizes long conversations and extracts key facts.
 */

function getMemoryDir(agentId: string): string {
  const config = getAgentConfig(agentId);
  return config.memoryDir;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Read the agent's MEMORY.md file. Returns empty string if not found. */
export function readMemory(agentId: string): string {
  const memoryFile = join(getMemoryDir(agentId), "MEMORY.md");
  try {
    if (existsSync(memoryFile)) {
      return readFileSync(memoryFile, "utf-8");
    }
  } catch {
    // ignore read errors
  }
  return "";
}

/** Append a single fact/line to MEMORY.md */
export function appendMemoryFact(agentId: string, fact: string): void {
  const dir = getMemoryDir(agentId);
  ensureDir(dir);
  const memoryFile = join(dir, "MEMORY.md");

  // Add newline before fact if file exists and doesn't end with newline
  let prefix = "";
  if (existsSync(memoryFile)) {
    const existing = readFileSync(memoryFile, "utf-8");
    if (existing.length > 0 && !existing.endsWith("\n")) {
      prefix = "\n";
    }
  }

  appendFileSync(memoryFile, `${prefix}- ${fact}\n`);
}

/** Replace entire MEMORY.md content */
export function replaceMemory(agentId: string, content: string): void {
  const dir = getMemoryDir(agentId);
  ensureDir(dir);
  const memoryFile = join(dir, "MEMORY.md");
  writeFileSync(memoryFile, content);
}

/** Write/append to daily note file (memory/YYYY-MM-DD.md) */
export function writeDailyNote(agentId: string, summary: string): void {
  const dir = getMemoryDir(agentId);
  ensureDir(dir);

  // Use Pacific timezone for date
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); // YYYY-MM-DD
  const noteFile = join(dir, `${dateStr}.md`);

  const timeStr = now.toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
  });

  const entry = `\n## ${timeStr}\n${summary}\n`;
  appendFileSync(noteFile, entry);
}

// Track consolidation cooldown (1 hour between consolidations per agent)
const lastConsolidation = new Map<string, number>();
const CONSOLIDATION_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

/**
 * Auto-consolidate a session if it exceeds the message threshold.
 *
 * 1. Counts unconsolidated messages in the session file
 * 2. If over threshold, calls Gemini to summarize + extract facts
 * 3. Appends facts to MEMORY.md
 * 4. Writes daily note summary
 * 5. Updates session metadata with last_consolidated pointer
 */
export async function consolidateSession(
  agentId: string,
  sessionFile: string,
  threshold = 50
): Promise<void> {
  // Check cooldown
  const lastTime = lastConsolidation.get(agentId) || 0;
  if (Date.now() - lastTime < CONSOLIDATION_COOLDOWN_MS) {
    return;
  }

  try {
    if (!existsSync(sessionFile)) return;

    const raw = readFileSync(sessionFile, "utf-8");
    const lines = raw.trim().split("\n");
    if (lines.length === 0) return;

    // Find unconsolidated range
    let startIdx = 0;
    let metadata: Record<string, unknown> | null = null;
    try {
      const firstLine = JSON.parse(lines[0]);
      if (firstLine._type === "metadata") {
        metadata = firstLine;
        startIdx = (firstLine.last_consolidated || 0) + 1;
      }
    } catch {
      // No metadata line
    }

    const unconsolidatedCount = lines.length - Math.max(1, startIdx);
    if (unconsolidatedCount < threshold) return;

    // Collect unconsolidated messages
    const messages: string[] = [];
    for (let i = Math.max(metadata ? 1 : 0, startIdx); i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.role && (entry.content || entry.text)) {
          const content = typeof entry.content === "string" ? entry.content : entry.text;
          if (content) {
            const role = entry.role === "assistant" ? "Agent" : "User";
            messages.push(`${role}: ${content}`);
          }
        }
      } catch {
        // skip malformed
      }
    }

    if (messages.length < threshold) return;

    const consolidationPrompt = `You are a memory consolidation assistant. Analyze this conversation and:

1. Extract key FACTS as bullet points (user preferences, decisions made, important context, names/dates mentioned).
2. Write a brief 2-3 sentence SUMMARY of the conversation.

Format your response exactly like this:

## Facts
- fact 1
- fact 2
- fact 3

## Summary
Brief summary here.

Conversation to analyze:
${messages.slice(-100).join("\n")}`;

    const agentConfig = getAgentConfig(agentId);
    let result: string | undefined;

    if (agentConfig.provider === "anthropic") {
      // Anthropic API for agents with provider "anthropic"
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
      const response = await client.messages.create({
        model: agentConfig.modelName || "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: consolidationPrompt }],
      });
      const block = response.content[0];
      result = block.type === "text" ? block.text : undefined;
    } else if (agentConfig.provider === "groq") {
      // Use Groq for Groq agents (e.g. Suzi)
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error("GROQ_API_KEY not set");
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: agentConfig.modelName || "llama-3.3-70b-versatile",
          max_tokens: 1024,
          temperature: 0.3,
          messages: [{ role: "user", content: consolidationPrompt }],
        }),
      });
      if (!res.ok) throw new Error(`Groq consolidation error ${res.status}`);
      const data = await res.json();
      result = data.choices?.[0]?.message?.content ?? undefined;
    } else {
      // Use Gemini for Gemini agents (default)
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: agentConfig.modelName || "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: consolidationPrompt }] }],
        config: { temperature: 0.3, maxOutputTokens: 1024 },
      });
      result = response.candidates?.[0]?.content?.parts?.[0]?.text ?? undefined;
    }

    if (!result) return;

    // Parse facts and summary
    const factsMatch = result.match(/## Facts\n([\s\S]*?)(?=\n## Summary|$)/);
    const summaryMatch = result.match(/## Summary\n([\s\S]*?)$/);

    if (factsMatch) {
      const facts = factsMatch[1]
        .split("\n")
        .filter((l) => l.trim().startsWith("-"))
        .map((l) => l.trim().replace(/^-\s*/, ""));

      const isVector = (() => {
        try { return !!getAgentConfig(agentId).vectorMemory; }
        catch { return false; }
      })();

      if (isVector) {
        // Vector path: embed and insert each fact (dedup handled by insertMemory)
        const { insertMemory } = await import("./vector-memory");
        for (const fact of facts) {
          await insertMemory(agentId, fact, {
            source: "consolidation",
            category: inferCategory(fact),
          });
        }
      } else {
        // File-based path (original)
        const existingMemory = readMemory(agentId);
        for (const fact of facts) {
          if (!existingMemory.includes(fact)) {
            appendMemoryFact(agentId, fact);
          }
        }
      }
    }

    if (summaryMatch) {
      writeDailyNote(agentId, summaryMatch[1].trim());
    }

    // Update session metadata with last_consolidated pointer
    const newLastConsolidated = lines.length - 1;
    if (metadata) {
      metadata.last_consolidated = newLastConsolidated;
      lines[0] = JSON.stringify(metadata);
    } else {
      lines.unshift(
        JSON.stringify({ _type: "metadata", last_consolidated: newLastConsolidated })
      );
    }
    writeFileSync(sessionFile, lines.join("\n") + "\n");

    lastConsolidation.set(agentId, Date.now());
    console.log(
      `[memory] Consolidated ${messages.length} messages for ${agentId}, extracted facts to MEMORY.md`
    );
  } catch (error) {
    console.error(`[memory] Consolidation error for ${agentId}:`, error);
  }
}

/** Simple keyword heuristic to categorize extracted facts. */
function inferCategory(fact: string): string {
  const lower = fact.toLowerCase();
  if (/\bprefer|like|dislike|favorite|love|hate|want\b/.test(lower))
    return "preference";
  if (/\bname is|birthday|wife|husband|daughter|son|friend|boss|susan|elle\b/.test(lower))
    return "person";
  if (/\bproject|app|build|deploy|launch|website|repo\b/.test(lower))
    return "project";
  if (/\bdecide|chose|pick|went with|agreed|approved\b/.test(lower))
    return "decision";
  return "fact";
}
