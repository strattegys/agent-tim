import { formatUsageSummaryText } from "../usage-events";
import type { ToolModule } from "./types";

const tool: ToolModule = {
  metadata: {
    id: "cost_summary",
    displayName: "Cost summary",
    category: "internal",
    description: "Aggregated usage and cost telemetry for Command Central.",
    operations: ["summary"],
    requiresApproval: false,
  },

  declaration: {
    name: "cost_summary",
    description:
      "Get metered LLM/TTS usage totals and breakdowns from the CRM usage table. " +
      "Optional: days_back (default 30) — interpreted as rolling window from now in UTC.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "Use 'summary'.",
        },
        days_back: {
          type: "string",
          description: "Optional number of days to include (default 30).",
        },
      },
      required: ["command"],
    },
  },

  async execute(args) {
    const cmd = (args.command || "").trim().toLowerCase();
    if (cmd !== "summary") {
      return "Unknown command. Use command=summary.";
    }
    let days = 30;
    if (args.days_back?.trim()) {
      const n = parseInt(args.days_back.trim(), 10);
      if (Number.isFinite(n) && n > 0 && n <= 366) days = n;
    }
    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - days);
    const text = await formatUsageSummaryText(from.toISOString(), to.toISOString());
    return text;
  },
};

export default tool;
