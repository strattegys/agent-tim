/**
 * Minimal Groq chat-completions helper for server routes (no tools / sessions).
 * Same model as artifact-chat and Suzi-style flows.
 */

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL =
  process.env.GROQ_CHAT_MODEL?.trim() || "openai/gpt-oss-120b";

export async function groqCompletion(
  system: string,
  user: string,
  opts?: { max_tokens?: number; temperature?: number; model?: string }
): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn("[groqCompletion] GROQ_API_KEY not set");
    return null;
  }
  try {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: opts?.model ?? DEFAULT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: opts?.temperature ?? 0.4,
        max_tokens: opts?.max_tokens ?? 4096,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      console.error("[groqCompletion] Groq error:", res.status, errText);
      return null;
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch (e) {
    console.error("[groqCompletion]", e);
    return null;
  }
}
