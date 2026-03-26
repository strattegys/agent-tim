/** Prepended to every Tim request that includes a work-queue row (client → API). */
export const TIM_COLLABORATION_FRAMEWORK = `PRIMARY FRAMEWORK (Command Central / Agent Team)
• Chat = Govind’s **instructions**: what to change, tone, questions, short acknowledgements.
• Work panes = **where the work product goes**: artifact tabs (Message draft, package raise, etc.). Use tools to read/write those surfaces.
• Never substitute a long chat reply for updating the pane. If he asked for copy or edits while a queue item is open, the deliverable belongs in the artifact (e.g. \`workflow_items\` \`update-workflow-artifact\`), then say briefly in chat that the pane was updated.`;

/** Work queue row the user has selected in Tim’s right-rail panel — sent as ephemeral chat context. */
export type TimWorkQueueSelection = {
  itemId: string;
  stage: string;
  stageLabel: string;
  itemTitle: string;
  workflowName: string;
  humanAction: string;
  /** Warm-outreach MESSAGED: waiting for follow-up window, not a draft-submit step */
  waitingFollowUp: boolean;
  /** Artifact tab open in the workspace (e.g. MESSAGE_DRAFT), or null while loading / intake. */
  focusedArtifactStage: string | null;
  /** Tab label shown in the UI (e.g. "Message draft"). */
  focusedArtifactLabel: string | null;
};

export function formatTimWorkQueueContext(s: TimWorkQueueSelection): string {
  const focusStage = s.focusedArtifactStage?.trim() || null;
  const focusLabel = s.focusedArtifactLabel?.trim() || null;
  const isMessageDraftTab =
    focusStage != null &&
    ["MESSAGE_DRAFT", "REPLY_DRAFT"].includes(focusStage.toUpperCase());

  const lines = [
    TIM_COLLABORATION_FRAMEWORK,
    ``,
    `The user has this item selected in Tim’s work queue (right panel). Treat their questions as about this item unless they clearly mean something else.`,
    ``,
  ];

  if (s.waitingFollowUp) {
    lines.push(
      `**WAITING (Messaged):** This contact is in the post-send pause. There is **no Submit** for a new draft until the workflow returns to MESSAGE_DRAFT (scheduled follow-up, or the user starts follow-up early in the UI). The next message draft is for a **follow-up bump/nudge**, not resending the same step. If they replied on LinkedIn, the human uses **Replied** (not you from chat).`,
      ``
    );
  }

  if (focusStage && focusLabel) {
    lines.push(
      `UI FOCUS: The user has the **${focusLabel}** tab open (artifact stage \`${focusStage}\`). ` +
        (isMessageDraftTab
          ? `They are working on the outbound message body shown in that pane. Put the **entire prospect-facing message** (body, links, sign-off) in **arg3** of \`workflow_items\` \`update-workflow-artifact\` only — **do not** paste that full copy into the chat thread; they read and submit from this tab. In chat, briefly confirm you updated the **${focusLabel}** tab (optional short summary is OK). arg1 = workflow item id below, arg2 = \`${focusStage}\`. **Submit** sends via Unipile after they accept the text in the panel.`
          : `If they ask to change this document, use \`update-workflow-artifact\` with arg2 = \`${focusStage}\` and arg3 = full markdown. Submit still sends only when the human task is a send step and they click Submit.`)
    );
    lines.push(``);
  } else {
    lines.push(
      `When an artifact tab is open, the UI will report which tab (e.g. Message draft). Use \`workflow_items\` \`update-workflow-artifact\` with arg1 = workflow item id, arg2 = that artifact’s stage, arg3 = full markdown. The user clicks **Submit** to approve the human task and trigger sending when applicable.`,
      ``,
    );
  }

  lines.push(
    `OUTBOUND LINKEDIN: You do not send DMs from chat. After they accept the copy in the panel, **Submit** runs delivery. Never claim you already sent.`,
    ``,
    `Workflow item id: ${s.itemId}`,
    `Prospect / title: ${s.itemTitle}`,
    `Workflow: ${s.workflowName}`,
    `Human-task stage: ${s.stageLabel} (${s.stage})`,
  );
  if (s.humanAction?.trim()) lines.push(`Human task: ${s.humanAction.trim()}`);
  return lines.join("\n");
}
