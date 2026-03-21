/**
 * Tools barrel export.
 *
 * Maintains backward compatibility:
 *   import { toolDeclarations, executeTool, APPROVAL_PHRASES } from "@/lib/tools"
 *
 * Also exports the full registry for the dashboard API.
 */

import type { ToolModule } from "./types";

// Individual tool modules
import twentyCrm from "./twenty-crm";
import linkedin from "./linkedin";
import scheduleMessage from "./schedule-message";
import webSearch from "./web-search";
import memoryTool from "./memory-tool";
import remindersTool from "./reminders-tool";
import agentManager from "./agent-manager";
import delegateTask from "./delegate-task";
import workflowManager from "./workflow-manager";

// ── Registry (keyed by tool name) ─────────────────────────────────────────
export const TOOL_REGISTRY: Record<string, ToolModule> = {
  twenty_crm: twentyCrm,
  linkedin: linkedin,
  schedule_message: scheduleMessage,
  web_search: webSearch,
  memory: memoryTool,
  reminders: remindersTool,
  agent_manager: agentManager,
  delegate_task: delegateTask,
  workflow_manager: workflowManager,
};

// ── Backward-compatible exports ───────────────────────────────────────────

/** Gemini function declarations array (same shape as the old toolDeclarations) */
export const toolDeclarations = Object.values(TOOL_REGISTRY).map(
  (t) => t.declaration
);

/** Re-export executeTool from executor.ts */
export { executeTool } from "./executor";

/** Re-export approval phrases */
export { APPROVAL_PHRASES } from "./shared";

/** Re-export types */
export type { ToolModule, ToolMetadata, ToolCategory, ToolContext } from "./types";
