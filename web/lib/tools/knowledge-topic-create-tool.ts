import {
  isMarniKbDatabaseConfigured,
  createKbTopic,
  type KbSourceMode,
} from "../marni-kb";
import type { ToolModule } from "./types";

function parseMode(raw: string | undefined): KbSourceMode {
  const s = (raw || "").trim().toLowerCase();
  if (s === "linkedin_only" || s === "linkedin") return "linkedin_only";
  if (s === "both") return "both";
  return "web_only";
}

function parseQueries(multiline: string | undefined): string[] {
  if (!multiline?.trim()) return [];
  return multiline
    .split(/\r?\n/)
    .map((q) => q.trim())
    .filter(Boolean);
}

const tool: ToolModule = {
  metadata: {
    id: "knowledge_topic_create",
    displayName: "Knowledge Studio — create topic",
    category: "internal",
    description:
      "Create a new Knowledge Studio research topic for Marni or Tim (web research → RAG chunks).",
    operations: ["create"],
    requiresApproval: false,
  },

  declaration: {
    name: "knowledge_topic_create",
    description:
      "Create a new **Knowledge Studio** research topic when Govind asks you to add, track, or research a subject in the knowledge base. " +
      "Supply a clear **name** and one or more **web search queries** (one per line) when the user wants web research; " +
      "otherwise you can create a placeholder topic and they can add queries in the work panel. " +
      "After creation, research runs via **Run now** in the Knowledge Base tab or on a schedule if cadence is set.",
    parameters: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Short topic title (e.g. 'B2B LinkedIn hooks Q1 2026')",
        },
        description: {
          type: "string",
          description: "Optional longer description of what to collect",
        },
        queries: {
          type: "string",
          description:
            "Web search queries, one per line (optional). Used when source_mode is web_only or both.",
        },
        post_urls: {
          type: "string",
          description: "LinkedIn post URLs to ingest later, one per line (optional)",
        },
        source_mode: {
          type: "string",
          description: "web_only (default), linkedin_only, or both",
        },
        cadence_minutes: {
          type: "string",
          description:
            "Optional repeat interval in minutes (15–10080) for automatic research; omit for manual-only",
        },
      },
      required: ["name"],
    },
  },

  async execute(args, { agentId }) {
    if (agentId !== "marni" && agentId !== "tim") {
      return "knowledge_topic_create is only available to Marni and Tim.";
    }
    if (!isMarniKbDatabaseConfigured()) {
      return "Knowledge Studio unavailable: CRM database not configured.";
    }
    const name = (args.name || "").trim();
    if (!name) return "Provide a non-empty name for the topic.";

    const description = (args.description || "").trim() || null;
    const queries = parseQueries(args.queries);
    const postUrls = parseQueries(args.post_urls);
    const sourceMode = parseMode(args.source_mode);

    let cadenceMinutes: number | null = null;
    const cadRaw = (args.cadence_minutes || "").trim();
    if (cadRaw) {
      const n = Math.floor(Number(cadRaw));
      if (Number.isFinite(n)) cadenceMinutes = Math.max(15, Math.min(10080, n));
    }

    try {
      const topic = await createKbTopic({
        agentId,
        name,
        description,
        queries,
        postUrls,
        sourceMode,
        cadenceMinutes,
        enabled: true,
      });
      const qNote =
        queries.length > 0
          ? `${queries.length} web quer${queries.length === 1 ? "y" : "ies"} saved.`
          : "No search queries yet — Govind can add them in Knowledge Base or ask you to update later.";
      const cadNote = cadenceMinutes
        ? `Cadence: every ${cadenceMinutes} minutes.`
        : "Manual runs (or set cadence later in the UI).";
      return (
        `Created Knowledge Studio topic **${topic.name}** (slug \`${topic.slug}\`, id \`${topic.id}\`) for **${agentId}**. ` +
        `${qNote} ${cadNote} Tell Govind they can open the **book (Knowledge base)** panel and click **Run now** to ingest, or wait for cadence.`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `knowledge_topic_create failed: ${msg}`;
    }
  },
};

export default tool;
