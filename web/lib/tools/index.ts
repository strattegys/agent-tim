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
import delegateTask from "./delegate-task";
import workflowManager from "./workflow-manager";
import workflowItems from "./workflow-items";
import packageManager from "./package-manager";
import punchListTool from "./punch-list-tool";
import notesTool from "./notes-tool";
import intakeTool from "./intake-tool";
import publishArticle from "./publish-article";
import articleBuilder from "./article-builder";
import knowledgeSearchTool from "./knowledge-search-tool";
import knowledgeTopicCreateTool from "./knowledge-topic-create-tool";
import workflowTypeDefinitions from "./workflow-type-definitions";
import costSummary from "./cost-summary";

// ── Registry (keyed by tool name) ─────────────────────────────────────────
/** Exported for providers that need to validate recovered / malformed tool names. */
export const TOOL_REGISTRY: Record<string, ToolModule> = {
  twenty_crm: twentyCrm,
  linkedin: linkedin,
  schedule_message: scheduleMessage,
  web_search: webSearch,
  memory: memoryTool,
  reminders: remindersTool,
  delegate_task: delegateTask,
  workflow_manager: workflowManager,
  workflow_items: workflowItems,
  package_manager: packageManager,
  punch_list: punchListTool,
  notes: notesTool,
  intake: intakeTool,
  publish_article: publishArticle,
  article_builder: articleBuilder,
  knowledge_search: knowledgeSearchTool,
  knowledge_topic_create: knowledgeTopicCreateTool,
  workflow_type_definitions: workflowTypeDefinitions,
  cost_summary: costSummary,
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
