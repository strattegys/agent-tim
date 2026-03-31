import { isMarniKbDatabaseConfigured, searchAgentKnowledge } from "../marni-kb";
import type { ToolModule } from "./types";

const tool: ToolModule = {
  metadata: {
    id: "knowledge_search",
    displayName: "Knowledge base search",
    category: "internal",
    description:
      "Semantic search over Knowledge Studio vector chunks for the active agent (Marni or Tim). Read-only.",
    operations: ["search"],
    requiresApproval: false,
  },

  declaration: {
    name: "knowledge_search",
    description:
      "Search this agent's Knowledge Studio corpus (Marni: playbooks; Tim: research + CRM/LinkedIn chunks). " +
      "Optional topicId scopes to one topic; optional personId (Twenty person UUID) scopes Tim's CRM-linked chunks for that contact.",
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
        person_id: {
          type: "string",
          description:
            "Optional Twenty CRM person UUID — limits hits to chunks tagged with that person (Tim CRM corpus)",
        },
      },
      required: ["query"],
    },
  },

  async execute(args, { agentId }) {
    if (agentId !== "marni" && agentId !== "tim") {
      return "knowledge_search is only available to Marni and Tim.";
    }
    if (!isMarniKbDatabaseConfigured()) {
      return "Knowledge base unavailable: CRM database not configured.";
    }
    const q = (args.query || "").trim();
    if (!q) return "Provide a non-empty query.";
    const topicId = (args.topicId || "").trim() || undefined;
    const personId = (args.person_id || "").trim() || undefined;
    try {
      const hits = await searchAgentKnowledge(agentId, q, {
        topK: 10,
        topicId: topicId ?? null,
        personId: personId ?? null,
      });
      if (hits.length === 0) {
        return "No relevant knowledge chunks found. Try different wording, run research, or sync Tim's CRM corpus.";
      }
      const lines = hits.map((h, i) => {
        const m = h.metadata || {};
        const title = typeof m.title === "string" ? m.title : "chunk";
        const url = typeof m.sourceUrl === "string" ? m.sourceUrl : "";
        const pid = typeof m.personId === "string" ? m.personId : "";
        const src = typeof m.source === "string" ? m.source : "";
        const sim = h.similarity != null ? Math.round(h.similarity * 100) : 0;
        const extra = [src && `src:${src}`, pid && `person:${pid.slice(0, 8)}…`]
          .filter(Boolean)
          .join(" ");
        const head = url
          ? `${i + 1}. [${sim}%] ${title} — ${url}${extra ? ` (${extra})` : ""}`
          : `${i + 1}. [${sim}%] ${title}${extra ? ` (${extra})` : ""}`;
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
