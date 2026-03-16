import { readFileSync } from "fs";

const promptCache = new Map<string, string>();

export function clearPromptCache(path?: string) {
  if (path) {
    promptCache.delete(path);
  } else {
    promptCache.clear();
  }
}

export function getSystemPrompt(promptFile?: string): string {
  const path = promptFile || "/root/.nanobot/system-prompt.md";

  const cached = promptCache.get(path);
  if (cached) return cached;

  try {
    const content = readFileSync(path, "utf-8");
    promptCache.set(path, content);
    return content;
  } catch {
    const fallback =
      "You are a helpful AI assistant. Be friendly, direct, and efficient.";
    promptCache.set(path, fallback);
    return fallback;
  }
}
