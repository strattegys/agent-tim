import { readFileSync } from "fs";
import { join } from "path";

let cachedPrompt: string | null = null;

export function getSystemPrompt(): string {
  if (cachedPrompt) return cachedPrompt;

  const promptPath = join(process.cwd(), "..", ".nanobot", "system-prompt.md");
  try {
    cachedPrompt = readFileSync(promptPath, "utf-8");
  } catch {
    // Fallback if file not found (development)
    cachedPrompt = `You are Tim, a professional AI assistant for business operations and CRM management. Be friendly, direct, and efficient. Keep responses concise.`;
  }
  return cachedPrompt;
}
