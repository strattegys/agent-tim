/**
 * Canonical query string for the Command Central shell (`/` + CommandCentralClient).
 * Keeps agent, panel, Friday tab, Suzi sub-tab, and lab flags in sync for reload/share.
 */

import type { FridayDashboardTab } from "@/lib/agent-ui-context";
import type { SuziWorkSubTab } from "@/lib/suzi-work-panel";

export type CommandCentralRightPanel =
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

export const VALID_COMMAND_CENTRAL_RIGHT_PANELS: CommandCentralRightPanel[] = [
  "info",
  "kanban",
  "dashboard",
  "reminders",
  "notes",
  "tasks",
  "messages",
  "costs",
  "marni-work",
  "agent-knowledge",
];

export const FRIDAY_WORK_DASHBOARD_PANELS = new Set<string>([
  "dashboard",
  "goals",
  "tasks",
  "tools",
  "cron",
  "architecture",
  "pkg-templates",
  "package-templates",
  "wf-templates",
  "workflow-templates",
  "workflow-manager",
  "packages",
  "planner",
  "package-kanban",
  "observation",
  "workflows",
  "pipelines",
]);

/** Truthy for `timLab`, `fridayLab`, `devLab`: `1` | `true` | `yes` (case-insensitive). */
export function labQueryTruthy(raw: string | null): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Friday work-panel tab from URL (`panel=` and legacy Penny / workflow links). */
export function fridayTabFromSearchParams(
  agent: string | null,
  panel: string | null
): FridayDashboardTab {
  if (panel === "tasks") return "package-kanban";
  if (panel === "tools") return "tools";
  if (panel === "goals") return "goals";
  if (panel === "cron") return "cron";
  if (panel === "architecture") return "architecture";
  if (panel === "pkg-templates" || panel === "package-templates") return "package-kanban";
  if (panel === "wf-templates" || panel === "workflow-templates") return "wf-templates";
  if (panel === "package-kanban") return "package-kanban";
  if (panel === "planner") return "package-kanban";
  if (agent === "penny" && panel === "dashboard") return "package-kanban";
  if (panel === "dashboard") return "goals";
  if (
    panel === "workflow-manager" ||
    panel === "packages" ||
    panel === "observation" ||
    panel === "workflows" ||
    panel === "pipelines"
  )
    return "package-kanban";
  return "goals";
}

export function fridayDashboardTabToPanelParam(tab: FridayDashboardTab): string {
  switch (tab) {
    case "package-kanban":
      return "tasks";
    case "wf-templates":
      return "wf-templates";
    case "tools":
      return "tools";
    case "goals":
      return "goals";
    case "cron":
      return "cron";
    case "architecture":
      return "architecture";
    default:
      return "goals";
  }
}

export function rightPanelToSearchParam(
  agent: string,
  rp: CommandCentralRightPanel,
  fridayTab: FridayDashboardTab
): string | null {
  if (agent === "friday" && rp === "dashboard") {
    return fridayDashboardTabToPanelParam(fridayTab);
  }
  if (rp === "info") return "info";
  if (rp === "messages") return "messages";
  if (rp === "reminders") return "reminders";
  if (rp === "notes") return "notes";
  if (rp === "tasks") return "tasks";
  if (rp === "costs") return "costs";
  if (rp === "marni-work") return "kanban";
  if (rp === "agent-knowledge") return "knowledge";
  if (rp === "kanban") return "kanban";
  return null;
}

const SUZI_SUB_TABS = new Set<SuziWorkSubTab>(["punchlist", "reminders", "notes", "intake"]);

export function parseSuziSubParam(raw: string | null): SuziWorkSubTab | null {
  if (raw === "intake" || raw === "notes" || raw === "punchlist" || raw === "reminders") {
    return raw;
  }
  return null;
}

export interface BuildCommandCentralSearchParamsInput {
  /** Existing query string (unknown keys are preserved). */
  base: URLSearchParams;
  timLabLayout: boolean;
  fridayLabLayout: boolean;
  /** Compact dev layout (`devLab=1`); ignored when tim/friday lab is on. */
  devCompactLayout: boolean;
  activeAgent: string;
  rightPanel: CommandCentralRightPanel;
  fridayDashboardTab: FridayDashboardTab;
  suziWorkSubTab: SuziWorkSubTab;
}

/**
 * Builds the full query string for the main shell. Clears and re-sets lab keys, `agent`, `panel`,
 * and `suziSub` so the URL stays canonical.
 */
export function buildCommandCentralSearchParams(
  input: BuildCommandCentralSearchParamsInput
): URLSearchParams {
  const out = new URLSearchParams(input.base.toString());
  out.delete("timLab");
  out.delete("fridayLab");
  out.delete("devLab");

  if (input.timLabLayout) {
    out.set("timLab", "1");
    out.set("agent", "tim");
    out.set("panel", "messages");
    out.delete("suziSub");
    return out;
  }

  if (input.fridayLabLayout) {
    out.set("fridayLab", "1");
    out.set("agent", "friday");
    out.set("panel", fridayDashboardTabToPanelParam(input.fridayDashboardTab));
    out.delete("suziSub");
    return out;
  }

  if (input.devCompactLayout) {
    out.set("devLab", "1");
  }

  out.set("agent", input.activeAgent);
  const panelQ = rightPanelToSearchParam(
    input.activeAgent,
    input.rightPanel,
    input.fridayDashboardTab
  );
  if (panelQ) {
    out.set("panel", panelQ);
  } else {
    out.delete("panel");
  }

  if (input.activeAgent === "suzi" && input.rightPanel === "reminders" && SUZI_SUB_TABS.has(input.suziWorkSubTab)) {
    out.set("suziSub", input.suziWorkSubTab);
  } else {
    out.delete("suziSub");
  }

  return out;
}

/** True if both query strings decode to the same key/value pairs (order-independent). */
export function urlSearchParamsSnapshotEqual(a: URLSearchParams, b: URLSearchParams): boolean {
  const keys = new Set<string>();
  for (const k of a.keys()) keys.add(k);
  for (const k of b.keys()) keys.add(k);
  for (const k of keys) {
    if (a.get(k) !== b.get(k)) return false;
  }
  return true;
}
