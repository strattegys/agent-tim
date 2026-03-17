/**
 * Convert standard Markdown to Slack mrkdwn format.
 *
 * Key differences:
 * - Bold: **text** → *text*
 * - Italic: *text* or _text_ → _text_
 * - Links: [text](url) → <url|text>
 * - Headers: # Header → *Header*
 * - Code blocks: ```lang\ncode``` → ```code```
 */
export function markdownToSlack(md: string): string {
  let text = md;

  // Links: [text](url) → <url|text>
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

  // Bold: **text** → *text*  (must come before italic)
  text = text.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Headers: ### Header → *Header*
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Horizontal rules
  text = text.replace(/^---+$/gm, "───────────────────");

  // Bullet lists: keep as-is (Slack supports - and •)

  return text;
}

/**
 * Truncate text to fit Slack's 40,000 char message limit.
 */
export function truncateForSlack(text: string, maxLen = 39000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n\n_(truncated — response too long)_";
}

/**
 * Format a full agent response for Slack posting.
 */
export function formatForSlack(text: string): string {
  return truncateForSlack(markdownToSlack(text));
}
