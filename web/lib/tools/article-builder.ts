import Anthropic from "@anthropic-ai/sdk";
import type { ToolModule } from "./types";

const MODEL = "claude-opus-4-6";
const MAX_TOKENS = 12000;

const WRITING_SYSTEM_PROMPT = `You are an expert long-form content writer for B2B technology and strategy audiences.

Your job is to produce a complete, publish-ready article in MDX format (standard Markdown — no JSX imports or custom components unless specifically instructed).

## Output Format

Return a single JSON object with these fields:
{
  "mdxContent": "The full article body in Markdown. Use ## and ### for sections. No frontmatter.",
  "suggestedTitle": "Compelling article title",
  "excerpt": "1-2 sentence hook for article cards (max 160 chars)",
  "seoTitle": "SEO-optimized page title (max 60 chars)",
  "seoDescription": "Meta description for search engines (max 155 chars)",
  "tags": ["tag1", "tag2", "tag3"]
}

## Writing Guidelines

- Lead with a strong hook — the first paragraph must earn the reader's attention.
- Back claims with data, examples, or clear reasoning. No vague platitudes.
- Write actionable content — every section should give the reader something they can use.
- Use conversational authority: confident but not arrogant, technical but accessible.
- Vary sentence length. Short sentences punch. Longer ones develop nuance and flow.
- Use subheadings (##) every 200-400 words to create scannable structure.
- Include a compelling introduction and a conclusion that drives action.
- Integrate keywords naturally — never stuff them.
- Target the specified word count. Going 10% over is fine; 20% under is not.
- Do NOT include frontmatter, import statements, or JSX components.
- Do NOT wrap the JSON in markdown code fences — return raw JSON only.`;

interface ArticleResult {
  mdxContent: string;
  suggestedTitle: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
  tags: string[];
}

function buildUserPrompt(args: Record<string, string>): string {
  const parts: string[] = [];

  parts.push(`## Topic\n${args.topic}`);

  if (args.research_notes) {
    parts.push(`## Research Notes\n${args.research_notes}`);
  }

  if (args.brief) {
    parts.push(`## Content Brief / Outline\n${args.brief}`);
  }

  if (args.audience) {
    parts.push(`## Target Audience\n${args.audience}`);
  }

  if (args.tone) {
    parts.push(`## Tone\n${args.tone}`);
  }

  if (args.keywords) {
    parts.push(`## Target Keywords\n${args.keywords}`);
  }

  const wordCount = args.word_count || "1500";
  parts.push(`## Target Word Count\n${wordCount} words`);

  parts.push(
    "\nWrite the full article now. Return ONLY the JSON object described in your instructions."
  );

  return parts.join("\n\n");
}

function parseResponse(raw: string): ArticleResult | null {
  try {
    // Try direct parse first
    return JSON.parse(raw) as ArticleResult;
  } catch {
    // Try extracting JSON from potential markdown fences
    const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (match) {
      try {
        return JSON.parse(match[1]) as ArticleResult;
      } catch {
        return null;
      }
    }
    // Try finding first { to last }
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as ArticleResult;
      } catch {
        return null;
      }
    }
    return null;
  }
}

const tool: ToolModule = {
  metadata: {
    id: "article_builder",
    displayName: "Article Builder",
    category: "internal",
    description:
      "Generates long-form MDX articles using the Anthropic API (dedicated model). " +
      "Returns article content plus SEO metadata ready for publish_article.",
    operations: ["generate"],
    requiresApproval: false,
  },

  declaration: {
    name: "article_builder",
    description:
      "Generate a full long-form article using the Anthropic API. " +
      "Provide the topic, research notes, and content brief. Returns MDX content + SEO metadata. " +
      "After receiving the output, use publish_article to create the draft on strattegys.com. " +
      "Args: topic (required), research_notes (required — your research findings), " +
      "brief (required — outline and key points), audience (target reader), " +
      "tone (writing style), keywords (comma-separated SEO keywords), " +
      "word_count (target, default 1500).",
    parameters: {
      type: "object" as const,
      properties: {
        topic: {
          type: "string",
          description: "Article topic or working title",
        },
        research_notes: {
          type: "string",
          description:
            "Research findings, data points, quotes, and source URLs",
        },
        brief: {
          type: "string",
          description:
            "Content brief: outline, key points, angles, structure guidance",
        },
        audience: {
          type: "string",
          description:
            "Target audience (e.g., 'B2B SaaS founders, Series A-C')",
        },
        tone: {
          type: "string",
          description:
            "Writing tone (e.g., 'authoritative but conversational')",
        },
        keywords: {
          type: "string",
          description: "Comma-separated SEO target keywords",
        },
        word_count: {
          type: "string",
          description: "Target word count (default: 1500)",
        },
      },
      required: ["topic", "research_notes", "brief"],
    },
  },

  async execute(args) {
    const { topic, research_notes, brief } = args;
    if (!topic) return "Error: topic is required";
    if (!research_notes) return "Error: research_notes is required";
    if (!brief) return "Error: brief is required";

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return "Error: ANTHROPIC_API_KEY not configured";

    const client = new Anthropic({ apiKey });
    const userPrompt = buildUserPrompt(args);

    console.log(
      `[article_builder] Generating article: "${topic}" (target: ${args.word_count || "1500"} words)`
    );

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: WRITING_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[article_builder] API error: ${msg}`);
      return `Error calling Anthropic API: ${msg}`;
    }

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const raw = textBlocks.map((b) => b.text).join("");

    if (!raw) return "Error: Anthropic API returned empty response";

    const parsed = parseResponse(raw);

    if (parsed) {
      const wordCount = parsed.mdxContent.split(/\s+/).length;
      console.log(
        `[article_builder] Generated: "${parsed.suggestedTitle}" (~${wordCount} words)`
      );

      return [
        "=== ARTICLE GENERATED ===",
        `Title: ${parsed.suggestedTitle}`,
        `Excerpt: ${parsed.excerpt}`,
        `SEO Title: ${parsed.seoTitle}`,
        `SEO Description: ${parsed.seoDescription}`,
        `Tags: ${parsed.tags.join(", ")}`,
        `Word Count: ~${wordCount}`,
        "",
        "=== MDX CONTENT ===",
        parsed.mdxContent,
        "=== END ===",
      ].join("\n");
    }

    // Fallback: return raw text if JSON parsing failed
    console.warn("[article_builder] JSON parse failed, returning raw output");
    const wordCount = raw.split(/\s+/).length;
    return [
      "=== ARTICLE GENERATED (raw — JSON parse failed) ===",
      `Word Count: ~${wordCount}`,
      "",
      "=== CONTENT ===",
      raw,
      "=== END ===",
    ].join("\n");
  },
};

export default tool;
