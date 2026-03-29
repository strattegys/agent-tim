import "server-only";

/**
 * Env vars checked in order. Google docs sometimes use GOOGLE_API_KEY for Gemini;
 * AI Studio exports often match GEMINI_API_KEY (see web/.env.local.example).
 */
const KEY_ENV_NAMES = [
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GEMINI_API_KEY",
] as const;

export function getGeminiApiKey(): string | undefined {
  for (const name of KEY_ENV_NAMES) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function hasGeminiApiKey(): boolean {
  return Boolean(getGeminiApiKey());
}

/** User-facing hint when embeddings / Gemini fail due to missing key. */
export function missingGeminiKeyUserMessage(): string {
  return (
    "No Gemini API key in the server environment. Add GEMINI_API_KEY to COMMAND-CENTRAL/web/.env.local " +
    "(same folder as package.json). If you use Docker dev, restart after edits: " +
    "`docker compose -f docker-compose.dev.yml restart web`. " +
    "Also accepted: GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY."
  );
}
