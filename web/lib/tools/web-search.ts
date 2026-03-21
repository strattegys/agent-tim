import { execFileSync } from "child_process";
import type { ToolModule } from "./types";
import { TOOL_TIMEOUT } from "./shared";

const tool: ToolModule = {
  metadata: {
    id: "web_search",
    displayName: "Web Search",
    category: "external",
    description: "Search the web for real-time information using the Brave Search API",
    externalSystem: "Brave Search API",
    operations: ["search"],
    requiresApproval: false,
  },

  declaration: {
    name: "web_search",
    description: "Search the web using Brave Search API.",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },

  async execute(args) {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) return "Web search not configured";

    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args.query)}&count=5`;
    return execFileSync(
      "curl",
      ["-s", "-H", `X-Subscription-Token: ${apiKey}`, url],
      { timeout: TOOL_TIMEOUT, encoding: "utf-8" }
    );
  },
};

export default tool;
