import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface ChatMessage {
  role: "user" | "model";
  text: string;
  timestamp: number;
}

interface JournalLine {
  _type?: string;
  role?: string;
  content?: string | null;
  timestamp?: string;
  tool_calls?: unknown;
  last_consolidated?: number;
}

/**
 * Read a JSONL session file and return displayable messages.
 * Skips metadata, tool_call lines, and null content.
 * Only returns unconsolidated messages (after last_consolidated).
 */
export function getHistory(sessionFile: string): ChatMessage[] {
  if (!existsSync(sessionFile)) return [];

  try {
    const raw = readFileSync(sessionFile, "utf-8");
    const lines = raw.trim().split("\n");
    if (lines.length === 0) return [];

    let startIdx = 0;
    const firstLine: JournalLine = JSON.parse(lines[0]);
    if (firstLine._type === "metadata" && firstLine.last_consolidated) {
      startIdx = firstLine.last_consolidated + 1;
    }

    const messages: ChatMessage[] = [];
    for (let i = Math.max(1, startIdx); i < lines.length; i++) {
      try {
        const entry: JournalLine = JSON.parse(lines[i]);
        if (!entry.role || !entry.content || entry.tool_calls || entry._type) {
          continue;
        }
        messages.push({
          role: entry.role === "assistant" ? "model" : "user",
          text: entry.content,
          timestamp: entry.timestamp
            ? new Date(entry.timestamp).getTime()
            : Date.now(),
        });
      } catch {
        // skip malformed lines
      }
    }

    return messages;
  } catch {
    return [];
  }
}

/**
 * Append a message to a JSONL session file.
 * Uses nanobot format: role=user/assistant, content, ISO timestamp.
 */
export function addMessage(sessionFile: string, msg: ChatMessage): void {
  // Ensure directory exists
  const dir = dirname(sessionFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const entry = {
    role: msg.role === "model" ? "assistant" : "user",
    content: msg.text,
    timestamp: new Date(msg.timestamp).toISOString(),
  };
  const line = JSON.stringify(entry) + "\n";
  writeFileSync(sessionFile, line, { flag: "a" });
}
