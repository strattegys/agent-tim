import { isMarniKbDatabaseConfigured, searchAgentKnowledge } from "../marni-kb";
import type { ToolModule } from "./types";

const tool: ToolModule = {
  metadata: {
    id: "knowledge_search",
    displayName: "Knowledge base search",
    category: "internal",
    description:
      "Semantic search over Marni's Knowledge Studio corpus (LinkedIn playbooks, research chunks). Read-only.",
    operations: ["search"],
    requiresApproval: false,
  },

  declaration: {
    name: "knowledge_search",
    description:
      "Search Marni's knowledge base for playbook content, hooks, and distribution guidance. " +
      "Use before drafting LinkedIn posts or outreach so output matches stored specs. " +
      "Pass a natural-language query describing what you need (e.g. 'B2B LinkedIn hook patterns'). " +
      "Optional topicId UUID to limit to one research topic.",
    parameters: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "What to find in the knowledge base",
        },
        topicId: {
          type: "string",
          description: "Optional topic UUID to scope search",
        },
      },
      required: ["query"],
    },
  },

  async execute(args, { agentId }) {
    if (agentId !== "marni") {
      return "knowledge_search is only available to Marni.";
    }
    if (!isMarniKbDatabaseConfigured()) {
      return "Knowledge base unavailable: CRM database not configured.";
    }
    const q = (args.query || "").trim();
    if (!q) return "Provide a non-empty query.";
    const topicId = (args.topicId || "").trim() || undefined;
    try {
      const hits = await searchAgentKnowledge("marni", q, {
        topK: 10,
        topicId: topicId ?? null,
      });
      if (hits.length === 0) {
        return "No relevant knowledge chunks found. Try different wording or run research in Knowledge Studio first.";
      }
      const lines = hits.map((h, i) => {
        const m = h.metadata || {};
        const title = typeof m.title === "string" ? m.title : "chunk";
        const url = typeof m.sourceUrl === "string" ? m.sourceUrl : "";
        const sim = h.similarity != null ? Math.round(h.similarity * 100) : 0;
        const head = url ? `${i + 1}. [${sim}%] ${title} — ${url}` : `${i + 1}. [${sim}%] ${title}`;
        return `${head}\n${h.content.slice(0, 900)}${h.content.length > 900 ? "…" : ""}`;
      });
      return lines.join("\n\n---\n\n");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `knowledge_search failed: ${msg}`;
    }
  },
};

export default tool;
