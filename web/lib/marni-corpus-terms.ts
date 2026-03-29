/** Client-safe term extraction for Marni corpus visualization (no server imports). */

export interface KbChunkLite {
  content: string;
  metadata: Record<string, unknown>;
}

/** Light stopword list (no extra deps). */
export const MARNI_TAG_STOP = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "her",
  "was",
  "one",
  "our",
  "out",
  "day",
  "get",
  "has",
  "him",
  "his",
  "how",
  "its",
  "may",
  "new",
  "now",
  "old",
  "see",
  "two",
  "who",
  "way",
  "she",
  "use",
  "that",
  "this",
  "with",
  "from",
  "have",
  "been",
  "they",
  "will",
  "what",
  "when",
  "your",
  "more",
  "than",
  "then",
  "them",
  "these",
  "some",
  "into",
  "just",
  "also",
  "only",
  "know",
  "take",
  "each",
  "which",
  "their",
  "time",
  "would",
  "there",
  "could",
  "other",
  "about",
  "after",
  "first",
  "well",
  "where",
  "much",
  "http",
  "https",
  "www",
  "com",
]);

export function termCountsFromChunks(chunks: KbChunkLite[]): Map<string, number> {
  const counts = new Map<string, number>();
  const wordRe = /[a-zA-Z]{3,}/g;
  for (const c of chunks) {
    const title = String(c.metadata?.title ?? "");
    const text = `${title} ${c.content}`.toLowerCase();
    let m: RegExpExecArray | null;
    wordRe.lastIndex = 0;
    while ((m = wordRe.exec(text)) !== null) {
      const w = m[0];
      if (MARNI_TAG_STOP.has(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return counts;
}

/** Top terms by frequency, stable tie-break by word. */
export function topTermsFromChunks(chunks: KbChunkLite[], maxTerms = 55): { word: string; count: number }[] {
  const counts = termCountsFromChunks(chunks);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTerms)
    .map(([word, count]) => ({ word, count }));
}
