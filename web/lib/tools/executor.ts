/**
 * Tool executor — dispatches tool calls to the correct module.
 */
import type { ToolContext } from "./types";
import { TOOL_REGISTRY } from "./index";
import { withToolGroundingHint } from "./tool-grounding-hint";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";

/** Tools that do not touch CRM / dashboard data — skip SSE nudge after success. */
const SKIP_DASHBOARD_NOTIFY = new Set<string>(["web_search", "memory"]);

export async function executeTool(
  name: string,
  args: Record<string, string>,
  lastUserMessage = "",
  agentId = "tim"
): Promise<string> {
  try {
    const tool = TOOL_REGISTRY[name];
    if (!tool) return `Unknown tool: ${name}`;

    const context: ToolContext = { lastUserMessage, agentId };
    const raw = await tool.execute(args, context);
    if (!SKIP_DASHBOARD_NOTIFY.has(name)) {
      notifyDashboardSyncChange();
    }
    return withToolGroundingHint(name, raw);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Tool error: ${msg}`;
  }
}
