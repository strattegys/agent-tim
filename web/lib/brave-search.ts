import "server-only";

import { mergeWebEnvLocalSync } from "./load-web-env-local";

export interface BraveWebResult {
  title: string;
  url: string;
  snippet: string;
}

export async function braveWebSearch(query: string, count = 5): Promise<BraveWebResult[]> {
  mergeWebEnvLocalSync();
  const apiKey = process.env["BRAVE_SEARCH_API_KEY"];
  if (!apiKey?.trim()) throw new Error("BRAVE_SEARCH_API_KEY is not set");
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, { headers: { "X-Subscription-Token": apiKey }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`Brave search HTTP ${res.status}`);
  const data = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  const results = data.web?.results ?? [];
  return results.map((r) => ({ title: r.title || "untitled", url: r.url || "", snippet: r.description || "" }));
}
