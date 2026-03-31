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
  | "marni-work"
  | "agent-knowledge";

export type FridayDashboardTab = "packages" | "tasks" | "tools";
/**
 * Sub-view under Friday → Packages: operational queue (with per-workflow Kanban),
 * draft/testing planner, and static templates.
 */
export type FridayPackageSubTab =
  | "queue"
  | "planner"
  | "pkg-templates"
  | "wf-templates";

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
  fridayPackageSubTab?: FridayPackageSubTab;
  /** Marni: selected research topic while Knowledge base (book panel) is open. */
  marniKnowledgeTopic?: { id: string; name: string } | null;
  /** Tim: selected research topic while Knowledge base (book panel) is open. */
  timKnowledgeTopic?: { id: string; name: string } | null;
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
    if (rightPanel === "agent-knowledge") {
      const lines = [
        "## Tim — UI (this message only)",
        "**Knowledge base** panel is open (book icon): Knowledge Studio topics and RAG chunks for **Tim’s** corpus (separate from Marni). Use **knowledge_search** so answers stay grounded. Work queue stays on the list icon.",
      ];
      const t = input.timKnowledgeTopic;
      if (t?.name) {
        lines.push(
          `- **Selected topic:** “${t.name}” (\`${t.id}\`). Use when they say “this topic” unless they clearly mean another.`
        );
      }
      return lines.join("\n");
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

  if (rightPanel === "agent-knowledge" && agentId === "marni") {
    const lines = [
      "## Marni — UI (this message only)",
      "**Knowledge base** panel is open (book icon next to Agent info): topics, corpus word cloud, activity log. Treat this as your **active corpus context** for the turn.",
      "The user asks questions **in this chat** — there is no separate Ask pane. For anything about playbooks, hooks, or what was ingested, call **knowledge_search** so answers stay grounded in chunks.",
    ];
    const t = input.marniKnowledgeTopic;
    if (t?.name) {
      lines.push(
        `- **Selected topic (Govind’s highlighted card):** “${t.name}” (\`${t.id}\`). Use this when they say “this topic” unless they clearly mean another.`
      );
    }
    return lines.join("\n");
  }

  if (rightPanel === "marni-work" && agentId === "marni") {
    return (
      "## Marni — UI (this message only)\n" +
      "Work panel — **Work queue** (distribution pipeline board). Knowledge base: **book** icon next to Agent info. Use workflow_items for content-distribution as in your prompt."
    );
  }

  if (rightPanel === "dashboard" && agentId === "friday") {
    const tab = input.fridayTab ?? "packages";
    const pkgSub = input.fridayPackageSubTab ?? "queue";
    let label: string;
    if (tab === "tasks") label = "Human tasks";
    else if (tab === "tools") label = "Tools registry";
    else if (tab === "packages") {
      label =
        pkgSub === "queue"
          ? "Packages — Queue (packages, workflow steps, open Kanban per workflow)"
          : pkgSub === "planner"
            ? "Packages — Planner (draft & testing)"
            : pkgSub === "pkg-templates"
              ? "Packages — Package templates"
              : "Packages — Workflow templates";
    } else {
      label = "Packages";
    }
    return (
      "## Friday — UI (this message only)\n" +
      `Right panel tab: **${label}**. Tools: workflow_manager, package_manager, web_search, memory.`
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
