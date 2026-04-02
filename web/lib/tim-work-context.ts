/** Prepended to every Tim request that includes a work-queue row (client → API). */
export const TIM_COLLABORATION_FRAMEWORK = `PRIMARY FRAMEWORK (Command Central)
• Chat = Govind’s **instructions**: what to change, tone, questions, short acknowledgements.
• Work panes = **where the work product goes**: artifact tabs (Message draft, package raise, etc.). Use tools to read/write those surfaces.
• Never substitute a long chat reply for updating the pane. If he asked for copy or edits while a queue item is open, the deliverable belongs in the artifact (e.g. \`workflow_items\` \`update-workflow-artifact\`), then say briefly in chat that the pane was updated.`;

/** Work queue row the user has selected in Tim’s right-rail panel — sent as ephemeral chat context. */
export type TimWorkQueueSelection = {
  itemId: string;
  /** When the sidebar row is a receipt, the workflow item to use for tools / artifacts (if any). */
  effectiveWorkflowItemId?: string | null;
  /** True when the user selected a per-message LinkedIn inbound receipt row. */
  isLinkedInInboundReceiptRow?: boolean;
  stage: string;
  stageLabel: string;
  itemTitle: string;
  workflowName: string;
  /** Registry workflow type when known (e.g. linkedin-connection-intake). */
  workflowType?: string;
  /** Postgres person id when source is a person row. */
  sourceId?: string | null;
  humanAction: string;
  /** Warm-outreach MESSAGED: waiting for follow-up window, not a draft-submit step */
  waitingFollowUp: boolean;
  /** Artifact tab open in the workspace (e.g. MESSAGE_DRAFT), or null while loading / intake. */
  focusedArtifactStage: string | null;
  /** Tab label shown in the UI (e.g. "Message draft"). */
  focusedArtifactLabel: string | null;
  /**
   * Warm / LinkedIn outreach: structured transcript from CRM artifacts (MESSAGED, REPLY_SENT, REPLIED, drafts).
   * Same builder as server-side REPLY_DRAFT autogen — so Tim chat sees the thread, not only the open tab.
   */
  linkedInThreadTranscript?: string | null;
  /**
   * When true, thread + package + enrichment are supplied in **SERVER WARM CONTEXT** (`/api/chat/stream`);
   * omit the client-side LinkedIn block here to avoid duplicate thread text in Groq.
   */
  omitLinkedInThreadFromChat?: boolean;
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

  const threadRaw = s.omitLinkedInThreadFromChat
    ? ""
    : (s.linkedInThreadTranscript ?? "").trim();
  if (threadRaw.length > 0) {
    const cap = 6500;
    const thread =
      threadRaw.length > cap ? `${threadRaw.slice(0, cap)}\n\n[LinkedIn thread truncated for length]` : threadRaw;
    lines.push(
      `## LinkedIn thread on this workflow item (CRM artifacts; chronological, oldest first)`,
      ``,
      `Read this before changing **Message draft** or **Reply draft**. **Respond to their latest message** in the natural conversation stage. Do **not** open like a cold DM, and do **not** re-send links or talking points they already thanked you for or acknowledged.`,
    );
    if (focusStage?.toUpperCase() === "REPLY_DRAFT") {
      lines.push(
        `**Reply draft mode:** The section **### REPLY TARGET (mandatory)** at the **end** of the thread block is what they last said — write for that. Lines labeled **DRAFT artifact** are obsolete proposals; do not polish or repeat them.`,
      );
    }
    lines.push(``, thread, ``);
  }

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
          ? `They are working on the outbound message body shown in that pane. Put the **entire prospect-facing message** (body, links, sign-off) in **arg3** of \`workflow_items\` \`update-workflow-artifact\` only — **do not** paste that full copy into the chat thread; they read and submit from this tab. In chat, briefly confirm you updated the **${focusLabel}** tab (optional short summary is OK). arg1 = workflow item id below, arg2 = \`${focusStage}\`. **Warm outreach:** after a draft is saved, you (Tim) post the **exact** plain-text send body in chat; Govind must reply **Send It Now** in this thread, then click **Submit** — only then does Unipile send.`
          : `If they ask to change this document, use \`update-workflow-artifact\` with arg2 = \`${focusStage}\` and arg3 = full markdown. Submit still sends only when the human task is a send step and they click Submit.`)
    );
    lines.push(``);
  } else {
    lines.push(
      `When an artifact tab is open, the UI will report which tab (e.g. Message draft). Use \`workflow_items\` \`update-workflow-artifact\` with arg1 = workflow item id, arg2 = that artifact’s stage, arg3 = full markdown. For **warm-outreach** message/reply drafts: after each save you post the exact send text in chat; Govind replies **Send It Now** then **Submit** to trigger Unipile.`,
      ``,
    );
  }

  lines.push(
    `OUTBOUND LINKEDIN (warm outreach): You do not send DMs from chat. **Submit** runs Unipile only after Govind has replied **Send It Now** following your chat post of the exact draft. Never claim you already sent before that.`,
    ``,
  );

  if (s.isLinkedInInboundReceiptRow) {
    const eff = (s.effectiveWorkflowItemId || "").trim();
    lines.push(
      `**LinkedIn inbound message row** (one row per received message). The queue row id may be a receipt id, not a workflow item.`,
      eff
        ? `Linked workflow item for artifacts/tools: \`${eff}\`.`
        : `No Tim workflow item is linked to this receipt yet — use CRM / general inbox to match or create a row; person id is in the selection if present.`,
      ``
    );
  }

  lines.push(
    `Workflow item id: ${(s.effectiveWorkflowItemId || s.itemId).trim() || s.itemId}`,
    `Prospect / title: ${s.itemTitle}`,
    `Workflow: ${s.workflowName}`,
    `Human-task stage: ${s.stageLabel} (${s.stage})`,
  );
  if (s.humanAction?.trim()) lines.push(`Human task: ${s.humanAction.trim()}`);

  const wt = (s.workflowType || "").trim();
  const st = (s.stage || "").trim().toUpperCase();
  const personId = (s.sourceId || "").trim();
  const isLinkedInIntakeMove =
    (wt === "linkedin-connection-intake" && st === "CONNECTION_ACCEPTED") ||
    (wt === "linkedin-general-inbox" && st === "LINKEDIN_INBOUND");
  const queueItemIdForClose = ((s.effectiveWorkflowItemId || s.itemId) || "").trim() || s.itemId;
  if (isLinkedInIntakeMove && personId) {
    lines.push(
      ``,
      `## Move to a package workflow (voice or tools)`,
      `When Govind asks to put this contact on a package pipeline (warm-outreach, linkedin-outreach, etc.), use **workflow_items** **add-person-to-workflow**: **arg1** = target workflow uuid (ACTIVE Tim package pipeline — not LinkedIn intake), **arg2** = person id \`${personId}\`, **arg3** = board stage key (e.g. \`TARGET\`, \`AWAITING_CONTACT\`, \`INITIATED\`; omit only if the first board stage is correct), **arg4** = this queue item id \`${queueItemIdForClose}\` to close this intake row after the new row is created.`,
      `To discover workflow ids, use **twenty_crm** or ask Govind to pick from the UI; you can also use **workflow_manager** \`list-workflows\` / \`get-workflow\` if that tool is available in this session.`,
    );
  }

  return lines.join("\n");
}
