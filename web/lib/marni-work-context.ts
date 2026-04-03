import { TIM_COLLABORATION_FRAMEWORK } from "@/lib/tim-work-context";

/** Selected row in Marni’s distribution work queue — sent as ephemeral chat context. */
export type MarniWorkQueueSelection = {
  itemId: string;
  stage: string;
  stageLabel: string;
  itemTitle: string;
  workflowName: string;
  workflowType: string;
  humanAction: string;
  humanTaskOpen: boolean;
  /** True when POSTED + future dueDate (scheduled slot in the UI). */
  scheduledSlot: boolean;
  focusedArtifactStage: string | null;
  focusedArtifactLabel: string | null;
};

export function formatMarniWorkQueueContext(s: MarniWorkQueueSelection): string {
  const focusStage = s.focusedArtifactStage?.trim() || null;
  const focusLabel = s.focusedArtifactLabel?.trim() || null;

  const lines = [
    TIM_COLLABORATION_FRAMEWORK,
    ``,
    `The user has this **content distribution** workflow item selected in Marni’s work queue. Treat questions as about this LinkedIn / distribution piece unless they clearly mean something else.`,
    ``,
    `**Artifact updates:** Use \`workflow_items\` **get-workflow-artifact** (arg1=item id below, arg2=stage key) to read markdown, then **update-workflow-artifact** with arg3 = the **complete** updated document. Typical stages: **CONN_MSG_DRAFTED** (connection note template for Tim), **POST_DRAFTED** (LinkedIn post body — no article URL in the post; put the link in the first comment per Govind’s rule).`,
    ``,
  ];

  if (s.scheduledSlot) {
    lines.push(
      `**Scheduled row:** Stage is POSTED with a **future** due date — treat as queued for publish. Copy tweaks still go through artifacts; do not claim the post is live unless Govind says so.`,
      ``
    );
  }

  if (focusStage && focusLabel) {
    lines.push(
      `UI FOCUS: **${focusLabel}** (\`${focusStage}\`). Prefer **get-workflow-artifact** then **update-workflow-artifact** with full markdown.`,
      ``
    );
  } else {
    lines.push(
      `When an artifact tab is open, read it with **get-workflow-artifact** before overwriting.`,
      ``
    );
  }

  lines.push(
    `Workflow item id: ${s.itemId}`,
    `Content title: ${s.itemTitle}`,
    `Workflow: ${s.workflowName}`,
    `Registry type: ${s.workflowType || "unknown"}`,
    `Stage: ${s.stageLabel} (${s.stage})`,
    s.humanTaskOpen ? `Human task open: yes (needs review or action when applicable)` : `Human task open: no`,
  );
  if (s.humanAction?.trim()) lines.push(`Human task: ${s.humanAction.trim()}`);
  return lines.join("\n");
}
