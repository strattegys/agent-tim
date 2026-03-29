/**
 * Light ephemeral UI hints for chat (per agent / panel). Keep short — system prompts stay canonical.
 * Suzi uses suzi-work-panel.ts instead. Tim row-specific context uses tim-work-context (workQueueContext).
 */

import { agentHasKanban } from "./agent-frontend";

export type AgentUiRightPanel =
  | "info"
  | "kanban"
  | "dashboard"
  | "reminders"
  | "notes"
  | "tasks"
  | "messages"
  | "costs"
  | "marni-work";

export type FridayDashboardTab = "packages" | "tasks" | "tools";
export type PennyDashboardTab = "packages" | "pkg-templates" | "wf-templates";

export interface AgentUiContextInput {
  agentId: string;
  rightPanel: AgentUiRightPanel;
  /**
   * Tim: when a work-queue row is selected, do not emit Tim uiContext —
   * `formatTimWorkQueueContext` already fills workQueueContext with full collaboration rules.
   */
  timHasWorkQueueSelection: boolean;
  /**
   * Ghost: when a content-queue row is selected, `formatGhostWorkQueueContext` fills workQueueContext.
   */
  ghostHasWorkQueueSelection?: boolean;
  fridayTab?: FridayDashboardTab;
  pennyTab?: PennyDashboardTab;
  /** Marni work panel: Work Queue vs Knowledge Base sub-tab. */
  marniWorkSubTab?: "queue" | "knowledge";
}

export function formatAgentUiContext(input: AgentUiContextInput): string | null {
  const { agentId, rightPanel, timHasWorkQueueSelection } = input;

  if (agentId === "suzi") return null;

  if (agentId === "ghost" && input.ghostHasWorkQueueSelection) return null;

  // Tim: never duplicate or dilute row-level instructions
  if (agentId === "tim") {
    if (timHasWorkQueueSelection) return null;
    if (rightPanel === "messages") {
      return [
        "## Tim — UI (this message only)",
        "No workflow row is selected in the work queue. Follow your system prompt and existing collaboration rules (chat vs panes, Submit, Unipile). When the user selects a row, detailed artifact context is sent in a separate block—do not contradict that when it appears.",
      ].join("\n");
    }
    if (rightPanel === "info") return null;
    return (
      "## Tim — UI (this message only)\n" +
      "No queue row selected — follow your system prompt and normal Tim rules."
    );
  }

  if (rightPanel === "info") return null;

  if (rightPanel === "kanban" && agentHasKanban(agentId)) {
    if (agentId === "scout") {
      return (
        "## Scout — UI (this message only)\n" +
        "Pipeline board is open (research-pipeline). Use workflow_items / CRM tools to advance handoffs toward Tim as usual."
      );
    }
    if (agentId === "ghost") {
      return (
        "## Ghost — UI (this message only)\n" +
        "Content pipeline board is open. Use workflow_items for content-pipeline stages as in your prompt."
      );
    }
    return (
      `## UI (this message only)\n` +
      `Kanban is open for ${agentId}. Use workflow_items when moving pipeline items.`
    );
  }

  if (rightPanel === "marni-work" && agentId === "marni") {
    const sub = input.marniWorkSubTab ?? "queue";
    if (sub === "knowledge") {
      return (
        "## Marni — UI (this message only)\n" +
        "Work panel — **Knowledge Base** tab (topics, Activity, Corpus, Ask). Use **knowledge_search** when drafting LinkedIn or messaging so output matches ingested playbooks."
      );
    }
    return (
      "## Marni — UI (this message only)\n" +
      "Work panel — **Work Queue** tab (distribution pipeline board). Use workflow_items for content-distribution as in your prompt."
    );
  }

  if (rightPanel === "dashboard" && agentId === "friday") {
    const tab = input.fridayTab ?? "packages";
    const label =
      tab === "packages"
        ? "Active packages"
        : tab === "tasks"
          ? "Human tasks"
          : "Tools registry";
    return (
      "## Friday — UI (this message only)\n" +
      `Right panel tab: **${label}**. Tools: workflow_manager, web_search, memory.`
    );
  }

  if (rightPanel === "dashboard" && agentId === "penny") {
    const tab = input.pennyTab ?? "packages";
    const label =
      tab === "packages"
        ? "Packages"
        : tab === "pkg-templates"
          ? "Package templates"
          : "Workflow templates";
    return (
      "## Penny — UI (this message only)\n" +
      `Right panel tab: **${label}**. Tools: package_manager, twenty_crm, web_search, memory.`
    );
  }

  if (rightPanel === "costs" && agentId === "king") {
    return (
      "## King — UI (this message only)\n" +
      "Cost-Usage panel is open. Use **cost_summary** (command=summary) for the same data in chat when asked."
    );
  }

  return null;
}
