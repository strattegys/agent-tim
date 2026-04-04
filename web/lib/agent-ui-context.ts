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
  | "agent-knowledge"
  | "scout-campaigns"
  | "penny-work";

/** Friday work panel — flat top-level tabs (dashboard / throughput, package kanban, workflow templates, tools, cron, architecture). */
export type FridayDashboardTab =
  | "goals"
  | "package-kanban"
  | "wf-templates"
  | "tools"
  | "cron"
  | "architecture";

/**
 * Sub-view inside Friday’s Architecture tab — nine machine-derived pillars (3 principals × 3 sub-views).
 * See `public/architecture/pillars/*.mmd` and `npm run architecture:generate`.
 */
export type FridayArchitecturePane =
  | "p1a"
  | "p1b"
  | "p1c"
  | "p2a"
  | "p2b"
  | "p2c"
  | "p3a"
  | "p3b"
  | "p3c"
  /** Curated infra story (manual `infra-overview.mmd`) */
  | "infra_curated"
  /** Library-only dependency graph (depcruise `graph-lib.mmd`) */
  | "code_lib";

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
  /** Marni: distribution work-queue row selected (work panel queue tab). */
  marniHasWorkQueueSelection?: boolean;
  fridayTab?: FridayDashboardTab;
  /** Friday Architecture tab: which inner pane is active. */
  fridayArchitecturePane?: FridayArchitecturePane;
  /** Marni: selected research topic while Knowledge base (book panel) is open. */
  marniKnowledgeTopic?: { id: string; name: string } | null;
  /** Tim: selected research topic while Knowledge base (book panel) is open. */
  timKnowledgeTopic?: { id: string; name: string } | null;
}

export function formatAgentUiContext(input: AgentUiContextInput): string | null {
  const { agentId, rightPanel, timHasWorkQueueSelection } = input;

  if (agentId === "suzi") return null;

  if (agentId === "ghost" && input.ghostHasWorkQueueSelection) return null;

  if (agentId === "marni" && input.marniHasWorkQueueSelection) return null;

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
        "**Knowledge base** panel is open (book icon): Knowledge Studio topics and RAG chunks for **Tim’s** corpus (separate from Marni). Use **knowledge_search** so answers stay grounded. Work Queue stays on the list icon.",
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

  if (rightPanel === "scout-campaigns" && agentId === "scout") {
    return (
      "## Scout — UI (this message only)\n" +
      "**Workspace** is open: **Dashboard** tab (campaign summary, pace, top packages) or **Campaign Throughput** — full package cards, daily goals, funnel counts. " +
      "Use **Open board** on a card for the kanban. Use workflow_items / CRM tools to move research-pipeline items toward Tim as usual."
    );
  }

  if (rightPanel === "penny-work" && agentId === "penny") {
    return (
      "## Penny — UI (this message only)\n" +
      "**Workspace** is open: **Accounts** (company list + detail from `/api/penny/accounts`), **Pipeline** (derived stages), **Products** (templates). " +
      "**Friday · Package Kanban** jumps to Friday for approvals and planner."
    );
  }

  if (rightPanel === "kanban" && agentHasKanban(agentId)) {
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
      "Work panel is open — **Dashboard** (throughput + queue depth + KB topic count), **Work Queue** (distribution items), **Board** (Kanban). With **no** queue row selected, pick one to ground LinkedIn draft work. Knowledge base: **book** icon. Use workflow_items for content-distribution as in your prompt."
    );
  }

  if (rightPanel === "dashboard" && agentId !== "friday") {
    return (
      "## UI (this message only)\n" +
      `**Dashboard** (placeholder) is open for **${agentId}** — reserved for a future overview; follow the agent’s normal tools and system prompt.`
    );
  }

  if (rightPanel === "dashboard" && agentId === "friday") {
    const tab = input.fridayTab ?? "goals";
    let label: string;
    if (tab === "goals") {
      label = "Dashboard (workflow throughput vs targets)";
    } else if (tab === "package-kanban") {
      label = "Package Kanban (draft → completed; details in overlay)";
    } else if (tab === "wf-templates") {
      label = "Workflow Templates";
    } else if (tab === "tools") {
      label = "Tools Registry";
    } else if (tab === "cron") {
      label = "Cron hub (all scheduled jobs, status, last run)";
    } else if (tab === "architecture") {
      const p = input.fridayArchitecturePane ?? "p1a";
      const names: Record<FridayArchitecturePane, string> = {
        p1a: "P1a Runtime topology (compose)",
        p1b: "P1b Edge & session (middleware)",
        p1c: "P1c Config (.env.example map)",
        p2a: "P2a HTTP API surface",
        p2b: "P2b Webhooks, cron API, job catalog",
        p2c: "P2c App pages / routes",
        p3a: "P3a Data tables (SQL migrations)",
        p3b: "P3b Agents & tools",
        p3c: "P3c Module graph (depcruise)",
        infra_curated: "Curated infra overview (manual)",
        code_lib: "Code graph — lib only (depcruise)",
      };
      label = `Architecture — ${names[p]}`;
    } else {
      label = "Dashboard (workflow throughput vs targets)";
    }
    return (
      "## Friday — UI (this message only)\n" +
      `Right panel tab: **${label}**. Tools: workflow_manager, package_manager, workflow_type_definitions, web_search, memory.`
    );
  }

  if (rightPanel === "costs" && agentId === "king") {
    return (
      "## King — UI (this message only)\n" +
      "**Workspace** is open: **Dashboard** tab (7-day headline costs + agent breakdown) or **Cost Usage** (full table, refresh, Anthropic sync). Use **cost_summary** (command=summary, optional days_back) in chat when asked."
    );
  }

  return null;
}
