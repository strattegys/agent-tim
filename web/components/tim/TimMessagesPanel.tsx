"use client";

import { useState, useEffect, useCallback, useRef, useMemo, useId } from "react";
import useSWR from "swr";
import { panelBus } from "@/lib/events";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type { TimWorkQueueSelection } from "@/lib/tim-work-context";
import { WARM_OUTREACH_MESSAGE_FOLLOW_UP_DAYS } from "@/lib/warm-outreach-cadence";
import { WARM_DISCOVERY_SOURCE_TYPE } from "@/lib/warm-discovery-item";
import { isWarmOutreachPlaceholderJobTitle } from "@/lib/warm-outreach-researching-guard";
import ArtifactViewer, { type ArtifactConfirmedWorkflowAction } from "../shared/ArtifactViewer";
import TimIntakeWorkspace from "./TimIntakeWorkspace";
import TimLinkedInInboxIntakeWorkspace from "./TimLinkedInInboxIntakeWorkspace";

/** Same as Friday human tasks — form-first steps */
const INPUT_ONLY_STAGES = new Set(["IDEA", "AWAITING_CONTACT"]);

const NO_REJECT_STAGES = new Set([
  "IDEA",
  "AWAITING_CONTACT",
  "CAMPAIGN_SPEC",
  "REVIEW",
  "DRAFT_PUBLISHED",
  "MESSAGE_DRAFT",
  "REPLY_DRAFT",
  "LINKEDIN_INBOUND",
  "CONNECTION_ACCEPTED",
]);

interface MessagingTask {
  itemId: string;
  /** Sidebar row kind; workflow rows omit this. */
  queueRowKind?: "linkedin_inbound";
  receiptId?: string;
  /** When queueRowKind is linkedin_inbound, workflow item for ArtifactViewer / resolve. */
  artifactWorkflowItemId?: string | null;
  unipileMessageId?: string | null;
  linkedinChatId?: string | null;
  itemTitle: string;
  itemSubtitle: string;
  sourceId: string | null;
  workflowId: string;
  workflowName: string;
  packageName: string;
  ownerAgent: string;
  packageId: string | null;
  packageNumber?: number | null;
  packageStage: string | null;
  inActiveCampaign: boolean;
  workflowType: string;
  stage: string;
  stageLabel: string;
  humanAction: string;
  dueDate: string | null;
  itemType: string;
  createdAt: string;
  /** Matches API; used for newest-first in messaging queue */
  updatedAt?: string;
  /** Latest LinkedIn send/receive time (receipt messageSentAt + sent/received artifacts). */
  lastMessageAt?: string | null;
  /** Warm-outreach MESSAGED — visible in Tim’s list but not an actionable draft submit */
  waitingFollowUp?: boolean;
  /** From human-tasks API; drives Needs action vs Waiting when stages are ambiguous */
  humanTaskOpen?: boolean;
  /** Discovery slot: Next/Contact placeholder person — show “add contact” in strip */
  contactSlotOpen?: boolean;
  contactName?: string | null;
  contactFirstName?: string | null;
  contactCompany?: string | null;
  contactTitle?: string | null;
  /** Person row still Next/Contact in CRM — intake artifacts not applied */
  contactDbSyncPending?: boolean;
  contactLinkedinPublicUrl?: string | null;
  contactLinkedinMemberId?: string | null;
  contactPrimaryEmail?: string | null;
}

/** Under the document title: person identity + LinkedIn (public URL + API member id) + email when present. */
function timPersonWorkflowHeaderDetail(task: MessagingTask) {
  const awaitingDetails =
    task.contactSlotOpen || task.stage === "AWAITING_CONTACT";
  const name = task.contactName?.trim() || "—";
  const company = task.contactCompany?.trim() || "—";
  const rawTitle = task.contactTitle?.trim() || "";
  const jobTitle =
    isWarmOutreachPlaceholderJobTitle(rawTitle) || !rawTitle ? "—" : rawTitle;
  const publicUrl = task.contactLinkedinPublicUrl?.trim() || "";
  const memberId = task.contactLinkedinMemberId?.trim() || "";
  const email = task.contactPrimaryEmail?.trim() || "";
  const hasAnyLinkedIn = Boolean(publicUrl || memberId);

  return (
    <div className="w-full max-w-full space-y-2 text-[10px] leading-snug">
      {awaitingDetails ? (
        <p className="border-b border-[var(--border-color)]/50 pb-1 text-[9px] font-medium text-[var(--text-tertiary)]">
          {task.workflowType === "linkedin-outreach"
            ? "LinkedIn outreach — awaiting contact details"
            : "Warm outreach — awaiting contact details"}
        </p>
      ) : null}

      {/* Name · LinkedIn · Company — one row (stacks on narrow); company column wider */}
      <div className="grid w-full grid-cols-1 gap-x-8 gap-y-2 border-b border-[var(--border-color)]/40 pb-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2.2fr)]">
        <div className="min-w-0">
          <div className="text-[9px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Name</div>
          <div className="mt-0.5 font-medium break-words text-[var(--text-primary)]">{name}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">LinkedIn</div>
          <div className="mt-0.5 min-w-0 space-y-1">
            {publicUrl ? (
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block break-all text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
              >
                Public profile
              </a>
            ) : null}
            {memberId ? (
              <span
                className="block break-all font-mono text-[9px] text-[var(--text-secondary)]"
                title="Unipile / LinkedIn API member id — used for send + inbound match when stored"
              >
                {memberId}
              </span>
            ) : null}
            {email ? (
              <a
                href={`mailto:${email}`}
                className="block break-all text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
              >
                {email}
              </a>
            ) : null}
            {!hasAnyLinkedIn && !email ? (
              awaitingDetails ? (
                <span className="text-[9px] leading-snug text-[var(--text-tertiary)]">
                  Include a LinkedIn URL in your notes; it appears here after the contact is saved to CRM (or sync from
                  intake).
                </span>
              ) : (
                <span className="text-[9px] text-[var(--text-secondary)]">
                  Not set — add profile URL or ACoA… on the person in CRM (see migrate-person-linkedin-provider.sql).
                </span>
              )
            ) : null}
          </div>
        </div>
        <div className="min-w-0 sm:pl-1">
          <div className="text-[9px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Company</div>
          <div className="mt-0.5 break-words text-[var(--text-chat-body)]">{company}</div>
        </div>
      </div>

      {/* Title — full width so long headlines wrap comfortably */}
      <div className="min-w-0 pt-0.5">
        <div className="text-[9px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Title</div>
        <p className="mt-1 max-w-none text-[11px] leading-relaxed break-words text-[var(--text-chat-body)]">
          {jobTitle}
        </p>
      </div>
    </div>
  );
}

function timShowsArtifactSubmit(task: MessagingTask): boolean {
  if (task.queueRowKind === "linkedin_inbound") return false;
  if (task.waitingFollowUp) return false;
  return (
    task.stage === "MESSAGE_DRAFT" ||
    task.stage === "REPLY_DRAFT" ||
    task.stage === "LINKEDIN_INBOUND" ||
    task.stage === "CONNECTION_ACCEPTED"
  );
}

/** Contact + company for queue card headline (Tim messaging rows). */
function timQueueContactHeadline(task: MessagingTask): string | null {
  const name = task.contactName?.trim() || task.itemTitle?.trim() || "";
  const company = task.contactCompany?.trim() || "";
  if (name && company) return `${name} · ${company}`;
  if (name) return name;
  if (company) return company;
  return null;
}

function timQueueUsesContactHeadline(task: MessagingTask): boolean {
  return (
    task.workflowType === "warm-outreach" ||
    task.workflowType === "linkedin-general-inbox" ||
    task.workflowType === "linkedin-connection-intake" ||
    task.workflowType === "linkedin-outreach" ||
    task.workflowType === "linkedin-inbound-message"
  );
}

/** Reserved titles: keep as primary (intake / placeholder rows). */
function timQueueCardTitleIsReserved(task: MessagingTask): boolean {
  if (task.contactSlotOpen) return true;
  const t = task.itemTitle?.trim() || "";
  if (t === "Contact — not saved yet") return true;
  if (t.startsWith("Next contact")) return true;
  if (t === "Awaiting contact") return true;
  if (t === "Warm outreach slot" || t === "Discovery slot") return true;
  return false;
}

function timQueueStepSubtitle(task: MessagingTask, workflowShortLabel: string): string {
  const step = task.stageLabel?.trim() || task.stage.replace(/_/g, " ");
  return `${workflowShortLabel} · ${step}`;
}

/** Queue card primary line: contact name · company when known; else workflow + step. */
function timQueueCardPrimaryTitle(task: MessagingTask): string {
  if (
    task.stage === "AWAITING_CONTACT" &&
    !task.workflowType?.trim() &&
    (!task.itemTitle?.trim() || task.itemTitle === "Unknown") &&
    !task.contactName?.trim()
  ) {
    return "Awaiting contact";
  }
  /** Warm outreach discovery row: single queue label; contact name lives in the work header detail. */
  if (task.workflowType === "warm-outreach" && task.stage === "AWAITING_CONTACT") {
    return "Awaiting contact";
  }
  if (timQueueUsesContactHeadline(task) && !timQueueCardTitleIsReserved(task)) {
    const headline = timQueueContactHeadline(task);
    if (headline) return headline;
  }
  if (task.workflowType === "warm-outreach") {
    const step = task.stageLabel?.trim() || task.stage.replace(/_/g, " ");
    return `Warm Outreach · ${step}`;
  }
  if (task.workflowType === "linkedin-general-inbox") {
    const step = task.stageLabel?.trim() || task.stage.replace(/_/g, " ");
    return `LinkedIn inbox · ${step}`;
  }
  if (task.workflowType === "linkedin-connection-intake") {
    const step = task.stageLabel?.trim() || task.stage.replace(/_/g, " ");
    return `LinkedIn connection · ${step}`;
  }
  if (task.workflowType === "linkedin-outreach") {
    const step = task.stageLabel?.trim() || task.stage.replace(/_/g, " ");
    return `LinkedIn outreach · ${step}`;
  }
  return task.itemTitle;
}

/** Second line: workflow step when primary is contact headline; else stage / legacy. */
function timQueueCardSecondaryLine(task: MessagingTask): string | null {
  if (timQueueUsesContactHeadline(task)) {
    if (timQueueCardTitleIsReserved(task)) {
      if (
        task.workflowType === "warm-outreach" &&
        task.stage === "AWAITING_CONTACT" &&
        task.itemSubtitle?.trim()
      ) {
        return task.itemSubtitle.trim();
      }
      return task.stageLabel?.trim() || task.itemSubtitle?.trim() || null;
    }
    const headline = timQueueContactHeadline(task);
    if (headline) {
      if (task.workflowType === "warm-outreach") {
        return timQueueStepSubtitle(task, "Warm outreach");
      }
      if (task.workflowType === "linkedin-general-inbox") {
        return timQueueStepSubtitle(task, "LinkedIn inbox");
      }
      if (task.workflowType === "linkedin-connection-intake") {
        return timQueueStepSubtitle(task, "LinkedIn connection");
      }
      if (task.workflowType === "linkedin-outreach") {
        return timQueueStepSubtitle(task, "LinkedIn outreach");
      }
    }
    // Primary is already workflow · step; avoid repeating the stage on line 2.
    return task.itemSubtitle?.trim() || null;
  }
  if (task.workflowType === "warm-outreach") {
    return task.itemTitle?.trim() || null;
  }
  return task.stageLabel?.trim() || null;
}

/** Sort key and display: prefer last LinkedIn message/note time, then workflow row updates. */
function timQueueItemActivityTimeMs(task: MessagingTask): number {
  const raw = (task.lastMessageAt || task.updatedAt || task.createdAt || "").trim();
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function formatTimQueueItemDateTime(task: MessagingTask): string {
  const raw = (task.lastMessageAt || task.updatedAt || task.createdAt || "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Three tabs only — mutual buckets over the merged Tim list (workflow + inbound receipts). */
type TimBucketTab = "needs_action" | "waiting" | "messages";

/** Packaged Agent Army / cold outreach: conversation active — triage under Messages, not mixed with pre-send drafts. */
const PACKAGED_LINKEDIN_TRIAGE_STAGES = new Set([
  "REPLY_DRAFT",
  "LINKEDIN_INBOUND",
  "REPLIED",
]);

/** Empty `selectedTypes` means no type filter (show all). */
function taskMatchesWorkflowTypes(task: MessagingTask, selectedTypes: string[]): boolean {
  if (selectedTypes.length === 0) return true;
  return selectedTypes.includes(task.workflowType);
}

function timTaskBucket(task: MessagingTask): TimBucketTab {
  if (task.queueRowKind === "linkedin_inbound") return "messages";
  const wf = task.workflowType;
  if (
    wf === "linkedin-general-inbox" ||
    wf === "linkedin-connection-intake" ||
    wf === "linkedin-inbound-message"
  ) {
    return "messages";
  }
  if (
    wf === "linkedin-outreach" &&
    Boolean(task.packageId) &&
    PACKAGED_LINKEDIN_TRIAGE_STAGES.has((task.stage || "").trim().toUpperCase())
  ) {
    return "messages";
  }
  if (task.waitingFollowUp) return "waiting";
  if (wf === "reply-to-close") {
    const sk = (task.stage || "").trim().toUpperCase();
    if (
      sk === "AWAITING_THEIR_REPLY" ||
      sk === "AWAITING_AFTER_FOLLOW_UP_ONE" ||
      sk === "AWAITING_AFTER_FOLLOW_UP_TWO"
    ) {
      return "waiting";
    }
  }
  if (wf === "linkedin-outreach") {
    const sk = (task.stage || "").trim().toUpperCase();
    if (
      sk === "INITIATED" ||
      sk === "ACCEPTED" ||
      sk === "MESSAGED" ||
      sk === "AWAITING_THEIR_REPLY" ||
      sk === "AWAITING_AFTER_FOLLOW_UP_ONE" ||
      sk === "AWAITING_AFTER_FOLLOW_UP_TWO" ||
      sk === "FOLLOW_UP_ONE_SENT" ||
      sk === "FOLLOW_UP_TWO_SENT" ||
      sk === "REPLY_SENT"
    ) {
      return "waiting";
    }
  }
  if (task.humanTaskOpen === false) return "waiting";
  return "needs_action";
}

function taskMatchesBucket(task: MessagingTask, tab: TimBucketTab): boolean {
  return timTaskBucket(task) === tab;
}

function workflowTypeFilterLabel(wt: string): string {
  switch (wt) {
    case "warm-outreach":
      return "Warm outreach";
    case "linkedin-outreach":
      return "LinkedIn outreach";
    case "linkedin-general-inbox":
      return "LinkedIn inbox";
    case "linkedin-connection-intake":
      return "LinkedIn connection";
    case "linkedin-inbound-message":
      return "LinkedIn messages";
    default:
      return wt.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Other";
  }
}

const POLL_INTERVAL_MS = 30_000;
const POLL_INTERVAL_HIDDEN_MS = 120_000;
const TIM_QUEUE_PAGE = 120;
/** Cards per page in the sidebar list (keep DOM small). */
const TIM_QUEUE_LIST_PAGE_SIZE = 5;
/** Workflow rows only — skips linkedinInboundFeed on the server (faster first paint). */
const TIM_QUEUE_WORKFLOW_SWR_KEY = "tim-messaging-workflow";
/** Inbound receipt rows — separate request; heavy LATERAL join per receipt. */
const TIM_QUEUE_INBOUND_SWR_KEY = "tim-messaging-inbound";
const TIM_INBOUND_FEED_LIMIT = 80;

interface TimTasksPage {
  workflowTasks: MessagingTask[];
  hasMore: boolean;
  nextOffset: number | null;
}

async function fetchTimWorkflowPage(): Promise<TimTasksPage> {
  const qs = new URLSearchParams({
    ownerAgent: "tim",
    messagingOnly: "1",
    linkedinInboundFeed: "0",
    limit: String(TIM_QUEUE_PAGE),
    offset: "0",
  });
  const r = await fetch(`/api/crm/human-tasks?${qs}`, { credentials: "include" });
  if (!r.ok) throw new Error(`Could not load queue (HTTP ${r.status}).`);
  const raw = await r.json();
  return {
    workflowTasks: Array.isArray(raw.tasks)
      ? raw.tasks.map((t: Record<string, unknown>) => mapRawToMessagingTask(t))
      : [],
    hasMore: Boolean(raw.hasMore),
    nextOffset: typeof raw.nextOffset === "number" ? raw.nextOffset : null,
  };
}

async function fetchTimInboundFeedPage(): Promise<MessagingTask[]> {
  const qs = new URLSearchParams({
    ownerAgent: "tim",
    messagingInboundOnly: "1",
    inboundFeedLimit: String(TIM_INBOUND_FEED_LIMIT),
  });
  const r = await fetch(`/api/crm/human-tasks?${qs}`, { credentials: "include" });
  if (!r.ok) throw new Error(`Could not load inbound feed (HTTP ${r.status}).`);
  const raw = await r.json();
  return Array.isArray(raw.linkedinInboundFeed)
    ? raw.linkedinInboundFeed.map((t: Record<string, unknown>) => mapRawToMessagingTask(t))
    : [];
}

function mapRawToMessagingTask(t: Record<string, unknown>): MessagingTask {
  const qrk = t.queueRowKind === "linkedin_inbound" ? "linkedin_inbound" : undefined;
  return {
    itemId: String(t.itemId),
    queueRowKind: qrk,
    receiptId: t.receiptId != null ? String(t.receiptId) : undefined,
    artifactWorkflowItemId:
      t.artifactWorkflowItemId != null && String(t.artifactWorkflowItemId).trim() !== ""
        ? String(t.artifactWorkflowItemId)
        : null,
    unipileMessageId:
      t.unipileMessageId != null && String(t.unipileMessageId).trim() !== ""
        ? String(t.unipileMessageId)
        : null,
    linkedinChatId:
      t.linkedinChatId != null && String(t.linkedinChatId).trim() !== ""
        ? String(t.linkedinChatId)
        : null,
    itemTitle: String(t.itemTitle || ""),
    itemSubtitle: String(t.itemSubtitle || ""),
    sourceId: t.sourceId != null ? String(t.sourceId) : null,
    workflowId: String(t.workflowId || ""),
    workflowName: String(t.workflowName || ""),
    packageName: String(t.packageName || ""),
    ownerAgent: String(t.ownerAgent || "tim"),
    packageId: t.packageId != null ? String(t.packageId) : null,
    packageNumber: t.packageNumber != null ? Number(t.packageNumber) : null,
    packageStage: t.packageStage != null ? String(t.packageStage) : null,
    inActiveCampaign: Boolean(t.inActiveCampaign),
    workflowType: String(t.workflowType || ""),
    stage: String(t.stage || ""),
    stageLabel: String(t.stageLabel || ""),
    humanAction: String(t.humanAction || ""),
    dueDate: t.dueDate != null ? String(t.dueDate) : null,
    itemType: String(t.itemType || "person"),
    createdAt: String(t.createdAt || ""),
    updatedAt:
      t.updatedAt != null && String(t.updatedAt).trim() !== ""
        ? String(t.updatedAt)
        : String(t.createdAt || ""),
    waitingFollowUp: Boolean(t.waitingFollowUp),
    humanTaskOpen: typeof t.humanTaskOpen === "boolean" ? t.humanTaskOpen : true,
    contactSlotOpen: Boolean(t.contactSlotOpen),
    contactName: t.contactName != null ? String(t.contactName) : null,
    contactFirstName:
      t.contactFirstName != null && String(t.contactFirstName).trim() !== ""
        ? String(t.contactFirstName).trim()
        : null,
    contactCompany: t.contactCompany != null ? String(t.contactCompany) : null,
    contactTitle: t.contactTitle != null ? String(t.contactTitle) : null,
    contactDbSyncPending: Boolean(t.contactDbSyncPending),
    contactLinkedinPublicUrl:
      t.contactLinkedinPublicUrl != null && String(t.contactLinkedinPublicUrl).trim() !== ""
        ? String(t.contactLinkedinPublicUrl)
        : null,
    contactLinkedinMemberId:
      t.contactLinkedinMemberId != null && String(t.contactLinkedinMemberId).trim() !== ""
        ? String(t.contactLinkedinMemberId)
        : null,
    contactPrimaryEmail:
      t.contactPrimaryEmail != null && String(t.contactPrimaryEmail).trim() !== ""
        ? String(t.contactPrimaryEmail)
        : null,
  };
}

/** `_workflow_item.id` and optional CRM `person.id` — shown in prod for support and agent context. */
function TimWorkQueueIdsAccessory({
  itemId,
  sourceId,
}: {
  itemId: string;
  sourceId: string | null;
}) {
  return (
    <span className="flex max-w-[min(100%,26rem)] flex-col items-end gap-0.5 text-right">
      <span
        className="font-mono text-[9px] leading-snug text-[var(--text-tertiary)] select-all break-all"
        title="Queue row id (_workflow_item.id)"
      >
        {itemId}
      </span>
      {sourceId ? (
        <span
          className="font-mono text-[9px] leading-snug text-[var(--text-tertiary)] select-all break-all opacity-85"
          title="CRM person id"
        >
          {sourceId}
        </span>
      ) : null}
    </span>
  );
}

function TimQueueItemRow({
  task,
  active,
  onSelect,
  className = "",
}: {
  task: MessagingTask;
  active: boolean;
  onSelect: () => void;
  /** e.g. `h-full min-h-0` when the row sits in a fixed-height slot */
  className?: string;
}) {
  const secondary = timQueueCardSecondaryLine(task);
  const whenLabel = formatTimQueueItemDateTime(task);
  const whenIso = (task.lastMessageAt || task.updatedAt || task.createdAt || "").trim();
  const whenTitle = (() => {
    if (!whenLabel) return undefined;
    const parts: string[] = [];
    if (task.lastMessageAt?.trim()) {
      parts.push(`Last LinkedIn send/receive: ${new Date(task.lastMessageAt).toLocaleString()}`);
    }
    if (task.updatedAt?.trim()) {
      parts.push(`Queue row updated: ${new Date(task.updatedAt).toLocaleString()}`);
    }
    if (task.createdAt?.trim()) {
      parts.push(`Queue row created: ${new Date(task.createdAt).toLocaleString()}`);
    }
    return parts.length ? parts.join("\n") : `Activity ${whenLabel}`;
  })();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`flex h-full min-h-0 w-full flex-col text-left rounded-lg border px-4 py-3.5 transition-colors ${
        active
          ? "border-[var(--accent-green)]/80 bg-[var(--accent-green)]/14 shadow-sm ring-2 ring-inset ring-[var(--accent-green)]/45"
          : "border-[var(--border-color)] bg-[var(--bg-primary)]/90 hover:border-[var(--text-tertiary)]/55 hover:bg-[var(--bg-primary)]"
      } ${className}`.trim()}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3">
          <div
            className={`min-h-0 min-w-0 flex-1 line-clamp-2 text-[12px] leading-relaxed break-words ${active ? "font-semibold text-[var(--text-primary)]" : "font-semibold text-[var(--text-chat-body)]"}`}
          >
            {timQueueCardPrimaryTitle(task)}
          </div>
          {whenLabel ? (
            <time
              dateTime={whenIso || undefined}
              title={whenTitle}
              className="shrink-0 self-start pt-0.5 text-[8px] leading-tight tabular-nums text-[var(--text-tertiary)]"
            >
              {whenLabel}
            </time>
          ) : null}
        </div>
        {secondary ? (
          <div className="shrink-0 text-[10px] text-[var(--text-tertiary)] break-words leading-snug">
            {secondary}
          </div>
        ) : null}
      </div>
    </button>
  );
}

export default function TimMessagesPanel({
  embedded = false,
  onWorkSelectionChange,
}: {
  embedded?: boolean;
  /** Lets main Tim chat include the selected queue row as ephemeral context. */
  onWorkSelectionChange?: (selection: TimWorkQueueSelection | null) => void;
}) {
  const [resolving, setResolving] = useState<string | null>(null);
  const [syncingWarmContact, setSyncingWarmContact] = useState(false);
  const [warmSyncHint, setWarmSyncHint] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Empty = all workflow types visible. */
  const [selectedWorkflowTypes, setSelectedWorkflowTypes] = useState<string[]>([]);
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const typeDropdownRef = useRef<HTMLDivElement>(null);
  const typeDropdownId = useId();
  const [listPage, setListPage] = useState(1);
  const [bucketTab, setBucketTab] = useState<TimBucketTab>("needs_action");
  const [resolveHint, setResolveHint] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const tabVisible = useDocumentVisible();

  const {
    data: swrPage,
    error: swrError,
    isLoading: loadingWorkflow,
    mutate: refreshWorkflow,
  } = useSWR<TimTasksPage>(TIM_QUEUE_WORKFLOW_SWR_KEY, fetchTimWorkflowPage, {
    refreshInterval: tabVisible ? POLL_INTERVAL_MS : POLL_INTERVAL_HIDDEN_MS,
    revalidateOnFocus: true,
    dedupingInterval: 10_000,
  });

  const { data: inboundFeedData, mutate: refreshInbound } = useSWR<MessagingTask[]>(
    TIM_QUEUE_INBOUND_SWR_KEY,
    fetchTimInboundFeedPage,
    {
      refreshInterval: tabVisible ? POLL_INTERVAL_MS * 2 : POLL_INTERVAL_HIDDEN_MS * 2,
      revalidateOnFocus: true,
      dedupingInterval: 15_000,
    },
  );

  const workflowTasks = swrPage?.workflowTasks ?? [];
  const inboundFeed = inboundFeedData ?? [];
  const loading = loadingWorkflow;
  const loadError = swrError
    ? (swrError instanceof Error ? swrError.message : "Network error loading queue.")
    : null;
  const queueHasMore = swrPage?.hasMore ?? false;

  const refreshQueue = useCallback(() => {
    void refreshWorkflow();
    void refreshInbound();
  }, [refreshWorkflow, refreshInbound]);

  useEffect(() => {
    const u1 = panelBus.on("workflow_items", refreshQueue);
    const u2 = panelBus.on("package_manager", refreshQueue);
    const u3 = panelBus.on("tim_human_task_progress", refreshQueue);
    return () => {
      u1();
      u2();
      u3();
    };
  }, [refreshQueue]);

  const loadMoreTasks = useCallback(async () => {
    if (!swrPage?.hasMore || loadingMore || swrPage.nextOffset == null) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams({
        ownerAgent: "tim",
        messagingOnly: "1",
        linkedinInboundFeed: "0",
        limit: String(TIM_QUEUE_PAGE),
        offset: String(swrPage.nextOffset),
      });
      const r = await fetch(`/api/crm/human-tasks?${qs}`, { credentials: "include" });
      if (!r.ok) return;
      const raw = await r.json();
      const next = Array.isArray(raw.tasks)
        ? raw.tasks.map((t: Record<string, unknown>) => mapRawToMessagingTask(t))
        : [];
      await refreshWorkflow((prev) => {
        if (!prev) return prev;
        const m = new Map(prev.workflowTasks.map((x) => [x.itemId, x]));
        for (const t of next) m.set(t.itemId, t);
        const workflowTasksNext = [...m.values()].sort(
          (a, b) => timQueueItemActivityTimeMs(b) - timQueueItemActivityTimeMs(a),
        );
        return {
          workflowTasks: workflowTasksNext,
          hasMore: Boolean(raw.hasMore),
          nextOffset: typeof raw.nextOffset === "number" ? raw.nextOffset : null,
        };
      }, false);
    } finally {
      setLoadingMore(false);
    }
  }, [swrPage, loadingMore, refreshWorkflow]);

  const sortedTasks = useMemo(() => {
    const merged = [...workflowTasks, ...inboundFeed];
    return merged.sort((a, b) => timQueueItemActivityTimeMs(b) - timQueueItemActivityTimeMs(a));
  }, [workflowTasks, inboundFeed]);

  const typeFilteredTasks = useMemo(
    () => sortedTasks.filter((t) => taskMatchesWorkflowTypes(t, selectedWorkflowTypes)),
    [sortedTasks, selectedWorkflowTypes],
  );

  const bucketCounts = useMemo(() => {
    let needs_action = 0;
    let waiting = 0;
    let messages = 0;
    for (const t of typeFilteredTasks) {
      const b = timTaskBucket(t);
      if (b === "needs_action") needs_action += 1;
      else if (b === "waiting") waiting += 1;
      else messages += 1;
    }
    return { needs_action, waiting, messages };
  }, [typeFilteredTasks]);

  const filteredUnifiedQueue = useMemo(
    () => typeFilteredTasks.filter((t) => taskMatchesBucket(t, bucketTab)),
    [typeFilteredTasks, bucketTab],
  );

  const filteredUnifiedQueueRef = useRef<MessagingTask[]>([]);
  filteredUnifiedQueueRef.current = filteredUnifiedQueue;

  const filterKey = useMemo(
    () => `${bucketTab}|${[...selectedWorkflowTypes].sort().join(",")}`,
    [bucketTab, selectedWorkflowTypes],
  );

  const listPageCount = Math.max(1, Math.ceil(filteredUnifiedQueue.length / TIM_QUEUE_LIST_PAGE_SIZE));
  const safeListPage = Math.min(listPage, listPageCount);
  const paginatedQueue = useMemo(() => {
    const start = (safeListPage - 1) * TIM_QUEUE_LIST_PAGE_SIZE;
    return filteredUnifiedQueue.slice(start, start + TIM_QUEUE_LIST_PAGE_SIZE);
  }, [filteredUnifiedQueue, safeListPage]);

  const workflowFilterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of sortedTasks) {
      if (t.workflowType) set.add(t.workflowType);
    }
    return [...set].sort();
  }, [sortedTasks]);

  useEffect(() => {
    setSelectedWorkflowTypes((prev) => prev.filter((wt) => workflowFilterOptions.includes(wt)));
  }, [workflowFilterOptions]);

  useEffect(() => {
    if (!selectedId) {
      setListPage(1);
      return;
    }
    const q = filteredUnifiedQueueRef.current;
    const idx = q.findIndex((t) => t.itemId === selectedId);
    if (idx < 0) setListPage(1);
    else setListPage(Math.floor(idx / TIM_QUEUE_LIST_PAGE_SIZE) + 1);
  }, [selectedId, filterKey]);

  useEffect(() => {
    setListPage((p) => Math.min(p, listPageCount));
  }, [listPageCount]);

  useEffect(() => {
    if (!typeDropdownOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (typeDropdownRef.current?.contains(e.target as Node)) return;
      setTypeDropdownOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [typeDropdownOpen]);

  useEffect(() => {
    if (filteredUnifiedQueue.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) =>
      prev && filteredUnifiedQueue.some((t) => t.itemId === prev)
        ? prev
        : filteredUnifiedQueue[0]?.itemId ?? null,
    );
  }, [filteredUnifiedQueue]);

  useEffect(() => {
    setWarmSyncHint(null);
    setResolveHint(null);
  }, [selectedId]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return filteredUnifiedQueue.find((t) => t.itemId === selectedId) ?? null;
  }, [filteredUnifiedQueue, selectedId]);

  const effectiveWorkflowItemId = useMemo(() => {
    if (!selected) return null;
    const a = selected.artifactWorkflowItemId?.trim();
    if (a) return a;
    if (selected.queueRowKind === "linkedin_inbound") return null;
    return selected.itemId;
  }, [selected]);

  /** `_workflow_item.id` for resolve, artifacts, and sync — empty when receipt row has no linked item. */
  const workflowOpsItemId = (effectiveWorkflowItemId || "").trim();

  const isInputStage = Boolean(selected && INPUT_ONLY_STAGES.has(selected.stage));

  const timPersonHeaderDetail =
    selected &&
    (selected.itemType === "person" || selected.itemType === WARM_DISCOVERY_SOURCE_TYPE) &&
    (selected.workflowType === "warm-outreach" ||
      selected.workflowType === "linkedin-outreach" ||
      selected.workflowType === "linkedin-general-inbox" ||
      selected.workflowType === "linkedin-connection-intake" ||
      selected.workflowType === "linkedin-inbound-message")
      ? timPersonWorkflowHeaderDetail(selected)
      : undefined;

  const useLinkedInInboxIntakeWorkspace = Boolean(
    selected &&
      selected.sourceId &&
      effectiveWorkflowItemId &&
      (selected.workflowType === "linkedin-connection-intake" ||
        (selected.workflowType === "linkedin-general-inbox" && selected.stage === "LINKEDIN_INBOUND"))
  );

  const [focusedArtifact, setFocusedArtifact] = useState<{
    stage: string;
    label: string;
  } | null>(null);
  /** CRM LinkedIn thread text for Tim chat (same structure as server REPLY_DRAFT autogen). */
  const [linkedInThreadTranscript, setLinkedInThreadTranscript] = useState<string | null>(null);

  useEffect(() => {
    setFocusedArtifact(null);
  }, [selectedId]);

  useEffect(() => {
    setLinkedInThreadTranscript(null);
  }, [selectedId]);

  useEffect(() => {
    if (!onWorkSelectionChange) return;
    if (!selected) {
      onWorkSelectionChange(null);
      return;
    }
    onWorkSelectionChange({
      itemId: selected.itemId,
      effectiveWorkflowItemId,
      isLinkedInInboundReceiptRow: selected.queueRowKind === "linkedin_inbound",
      workflowType: selected.workflowType,
      sourceId: selected.sourceId,
      stage: selected.stage,
      stageLabel: selected.stageLabel,
      itemTitle: selected.itemTitle,
      workflowName: selected.workflowName,
      humanAction: selected.humanAction,
      waitingFollowUp: Boolean(selected.waitingFollowUp),
      focusedArtifactStage: isInputStage ? null : focusedArtifact?.stage ?? null,
      focusedArtifactLabel: isInputStage ? null : focusedArtifact?.label ?? null,
      linkedInThreadTranscript:
        selected.workflowType === "warm-outreach" || selected.workflowType === "linkedin-outreach"
          ? linkedInThreadTranscript
          : null,
      omitLinkedInThreadFromChat:
        selected.workflowType === "warm-outreach" || selected.workflowType === "linkedin-outreach",
    });
  }, [selected, isInputStage, focusedArtifact, onWorkSelectionChange, linkedInThreadTranscript, effectiveWorkflowItemId]);

  useEffect(() => {
    return () => {
      onWorkSelectionChange?.(null);
    };
  }, [onWorkSelectionChange]);

  const handleResolve = useCallback(
    async (
      itemId: string,
      action: "approve" | "reject" | "input" | "replied" | "ended" | "dismiss",
      notes?: string
    ) => {
      if (resolving) return;
      if (itemId.startsWith("receipt:")) return;
      setResolving(itemId);
      try {
        const res = await fetch("/api/crm/human-tasks/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId,
            action,
            notes: notes || undefined,
          }),
        });
        const data = await res.json();
        const taskRow = sortedTasks.find((t) => t.itemId === itemId);
        const resolvedPackageId =
          (data as { packageId?: string | null }).packageId ?? taskRow?.packageId ?? null;
        const pushLogs = (logs: string[]) => {
          if (!logs?.length || !resolvedPackageId) return;
          try {
            const key = `simLog-${resolvedPackageId}`;
            const existing = JSON.parse(sessionStorage.getItem(key) || "[]");
            sessionStorage.setItem(key, JSON.stringify([...[...logs].reverse(), ...existing]));
            panelBus.emit("sim_log");
          } catch {
            /* ignore */
          }
        };
        if (data.ok) {
          setResolveHint(null);
          if (data.logs?.length) pushLogs(data.logs);
          panelBus.emit("tim_human_task_progress");
          panelBus.emit("dashboard_sync");
          await new Promise((r) => setTimeout(r, 350));
          await Promise.all([refreshWorkflow(), refreshInbound()]);
        } else {
          const errText =
            typeof (data as { error?: string }).error === "string"
              ? (data as { error: string }).error
              : `HTTP ${res.status}`;
          setResolveHint(errText);
          pushLogs([
            `[${new Date().toISOString()}] Resolve failed: ${data.error || res.status}`,
            ...(data.logs || []),
          ]);
        }
      } catch {
        /* ignore */
      }
      setResolving(null);
    },
    [refreshWorkflow, refreshInbound, resolving, sortedTasks]
  );

  /** Header actions (ArtifactViewer top-right): warm-outreach steps + Reject when that transition is allowed. */
  const timArtifactHeaderActions = useMemo((): ArtifactConfirmedWorkflowAction[] | undefined => {
    if (!selected) return undefined;
    if (selected.queueRowKind === "linkedin_inbound" && !effectiveWorkflowItemId) return undefined;
    const id = effectiveWorkflowItemId ?? selected.itemId;
    const actions: ArtifactConfirmedWorkflowAction[] = [];

    if (selected.workflowType === "linkedin-general-inbox") {
      actions.push({
        id: "dismiss-general-inbox",
        label: "Dismiss from queue",
        variant: "neutral",
        confirmMessage:
          "Remove this LinkedIn general inbox row from Tim’s queue? The item and its inbox artifacts will be archived (soft-deleted).",
        onConfirm: async () => {
          await handleResolve(id, "dismiss");
        },
      });
    }

    if (selected.workflowType === "linkedin-connection-intake") {
      actions.push({
        id: "dismiss-connection-intake",
        label: "Dismiss from queue",
        variant: "neutral",
        confirmMessage:
          "Remove this connection-intake row? Use after you’ve moved them to a package workflow or decided no follow-up. The row and artifacts will be archived (soft-deleted).",
        onConfirm: async () => {
          await handleResolve(id, "dismiss");
        },
      });
    }

    if (selected.workflowType === "warm-outreach") {
      if (selected.stage === "MESSAGED") {
        actions.push({
          id: "replied",
          label: "Replied",
          variant: "amber",
          confirmMessage:
            "They really replied on LinkedIn? This moves the workflow into reply drafting. Only confirm if they actually messaged you.",
          onConfirm: () => handleResolve(id, "replied"),
        });
      }
      if (selected.stage === "REPLY_DRAFT") {
        actions.push({
          id: "end-sequence",
          label: "End sequence",
          variant: "danger",
          confirmMessage:
            "End this warm-outreach sequence for this contact? The item will move to Ended.",
          onConfirm: () => handleResolve(id, "ended"),
        });
      }
    }

    if (!NO_REJECT_STAGES.has(selected.stage)) {
      actions.push({
        id: "reject",
        label: "Reject",
        variant: "danger",
        confirmMessage:
          selected.stage === "MESSAGED" &&
          (selected.workflowType === "warm-outreach" || selected.workflowType === "linkedin-outreach")
            ? "Move back to Message Draft to fix or resend? MESSAGED confirmation artifacts for this item will be removed."
            : "Reject this step? The workflow will move to the redraft or rejection path for this item.",
        onConfirm: () => handleResolve(id, "reject"),
      });
    }

    return actions.length > 0 ? actions : undefined;
  }, [selected, handleResolve, effectiveWorkflowItemId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-[var(--text-tertiary)]">Loading work queue…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {!embedded && (
        <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <span className="text-xs font-medium text-[var(--text-chat-body)]">Tim messaging queue</span>
          {loadError && (
            <p className="text-[10px] text-[var(--text-secondary)] mt-1">{loadError}</p>
          )}
        </div>
      )}
      {embedded && loadError && (
        <div className="shrink-0 px-3 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <p className="text-[10px] text-[var(--text-secondary)]">{loadError}</p>
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-row">
        <aside
          className="flex min-h-0 w-[30%] min-w-[192px] max-w-[312px] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-secondary)]/60"
          aria-label="Tim messaging queue"
        >
          <div className="shrink-0 px-2.5 py-2 border-b border-[var(--border-color)]/80 space-y-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              {`List · ${filteredUnifiedQueue.length}${
                selectedWorkflowTypes.length > 0 ? ` / ${typeFilteredTasks.length}` : ""
              }`}
            </span>
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Queue buckets">
              {(
                [
                  ["needs_action", "Needs action", bucketCounts.needs_action] as const,
                  ["waiting", "Waiting", bucketCounts.waiting] as const,
                  ["messages", "Messages", bucketCounts.messages] as const,
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={bucketTab === key}
                  onClick={() => setBucketTab(key)}
                  className={`text-[9px] px-2 py-0.5 rounded-full border shrink-0 transition-colors tabular-nums ${
                    bucketTab === key
                      ? "border-[var(--accent-green)]/60 bg-[var(--accent-green)]/15 text-[var(--text-primary)] font-medium"
                      : "border-[var(--border-color)] bg-[var(--bg-primary)]/80 text-[var(--text-secondary)] hover:border-[var(--text-tertiary)]/40"
                  }`}
                >
                  {label} ({count})
                </button>
              ))}
            </div>
            {sortedTasks.length > 0 ? (
                <div className="relative" ref={typeDropdownRef}>
                  <button
                    type="button"
                    id={typeDropdownId}
                    aria-expanded={typeDropdownOpen}
                    aria-haspopup="listbox"
                    onClick={() => setTypeDropdownOpen((o) => !o)}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)]/90 px-2 py-1.5 text-left text-[10px] font-medium text-[var(--text-chat-body)] hover:border-[var(--text-tertiary)]/40"
                  >
                    <span className="min-w-0 truncate">
                      {selectedWorkflowTypes.length === 0
                        ? "Types: all"
                        : `Types: ${selectedWorkflowTypes.length} selected`}
                    </span>
                    <span className="shrink-0 text-[var(--text-tertiary)]" aria-hidden>
                      {typeDropdownOpen ? "▴" : "▾"}
                    </span>
                  </button>
                  {typeDropdownOpen ? (
                    <div
                      role="listbox"
                      aria-labelledby={typeDropdownId}
                      className="absolute left-0 right-0 z-40 mt-1 max-h-[14rem] overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] py-1 shadow-lg"
                    >
                      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--border-color)]/80 bg-[var(--bg-primary)] px-2 py-1">
                        <span className="text-[9px] font-medium text-[var(--text-tertiary)]">Workflow types</span>
                        <button
                          type="button"
                          className="text-[9px] font-medium text-[var(--accent-green)] hover:underline"
                          onClick={() => setSelectedWorkflowTypes([])}
                        >
                          Clear
                        </button>
                      </div>
                      {workflowFilterOptions.map((wt) => {
                        const checked = selectedWorkflowTypes.includes(wt);
                        return (
                          <label
                            key={wt}
                            className="flex cursor-pointer items-start gap-2 px-2 py-1.5 text-[10px] hover:bg-[var(--bg-secondary)]"
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 shrink-0 rounded border-[var(--border-color)]"
                              checked={checked}
                              onChange={() => {
                                setSelectedWorkflowTypes((prev) =>
                                  prev.includes(wt) ? prev.filter((x) => x !== wt) : [...prev, wt],
                                );
                              }}
                            />
                            <span className="min-w-0 break-words text-[var(--text-chat-body)]">
                              {workflowTypeFilterLabel(wt)}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-2.5 py-2">
            <div className="flex min-h-0 flex-1 flex-col">
              {sortedTasks.length === 0 ? (
                <p className="flex flex-1 items-center justify-center text-center text-[10px] text-[var(--text-tertiary)] px-1">
                  No rows
                </p>
              ) : filteredUnifiedQueue.length === 0 ? (
                <p className="flex flex-1 items-center justify-center text-center text-[10px] text-[var(--text-tertiary)] px-1">
                  Nothing in this bucket. Try another tab or widen types.
                </p>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  {Array.from({ length: TIM_QUEUE_LIST_PAGE_SIZE }, (_, i) => {
                    const task = paginatedQueue[i];
                    if (!task) {
                      return (
                        <div
                          key={`tim-queue-slot-${i}`}
                          className="min-h-0 flex-1 basis-0 rounded-lg border border-dashed border-[var(--border-color)]/35 bg-[var(--bg-secondary)]/25"
                          aria-hidden
                        />
                      );
                    }
                    return (
                      <div key={task.itemId} className="flex min-h-0 flex-1 basis-0 flex-col">
                        <TimQueueItemRow
                          task={task}
                          active={task.itemId === selectedId}
                          onSelect={() => setSelectedId(task.itemId)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {listPageCount > 1 ? (
              <div
                className="shrink-0 border-t border-[var(--border-color)]/60 pt-2 mt-2 flex flex-wrap items-center justify-center gap-1"
                role="navigation"
                aria-label="Queue pages"
              >
                {Array.from({ length: listPageCount }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setListPage(p)}
                    className={`min-w-[1.75rem] rounded border px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors ${
                      safeListPage === p
                        ? "border-[var(--accent-green)]/70 bg-[var(--accent-green)]/15 text-[var(--text-primary)]"
                        : "border-[var(--border-color)] bg-[var(--bg-primary)]/70 text-[var(--text-secondary)] hover:border-[var(--text-tertiary)]/50"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            ) : null}
            {queueHasMore ? (
              <div className="shrink-0 pt-2">
                <button
                  type="button"
                  onClick={() => loadMoreTasks()}
                  disabled={loadingMore}
                  className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-primary)]/60 px-2 py-1.5 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                >
                  {loadingMore ? "Loading…" : "Load more from server"}
                </button>
                <p className="text-[8px] text-[var(--text-tertiary)] mt-1 leading-snug">
                  Polling refreshes the first server page; load more to extend the queue.
                </p>
              </div>
            ) : null}
          </div>
        </aside>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col p-2">
          {selected ? (
            <>
              {selected.queueRowKind === "linkedin_inbound" && !workflowOpsItemId ? (
                <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-1">
                  {timPersonHeaderDetail ? (
                    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2.5">
                      {timPersonHeaderDetail}
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-3">
                    <p className="text-[11px] leading-snug text-[var(--text-chat-body)]">
                      This message is stored as an inbound receipt, but no Tim workflow row matched this person yet. When a
                      general inbox or package row exists, refresh the list or open that workflow item.
                    </p>
                    {selected.unipileMessageId ? (
                      <p className="mt-2 font-mono text-[9px] text-[var(--text-tertiary)] break-all select-all">
                        Unipile message id: {selected.unipileMessageId}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
              <>
              {selected.contactDbSyncPending ? (
                <div className="shrink-0 mb-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2">
                  <p className="text-[11px] text-[var(--text-chat-body)] leading-snug">
                    The CRM <strong className="text-[var(--text-primary)]">person</strong> for this slot is still the
                    placeholder (Next / Contact). Your notes exist on the workflow but were never written to the contact
                    record.
                  </p>
                  {warmSyncHint ? (
                    <p className="text-[10px] text-[var(--text-secondary)] mt-1.5 leading-snug">{warmSyncHint}</p>
                  ) : null}
                  <button
                    type="button"
                    disabled={syncingWarmContact}
                    onClick={async () => {
                      setSyncingWarmContact(true);
                      setWarmSyncHint(null);
                      try {
                        const r = await fetch("/api/crm/human-tasks/sync-warm-person", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({ itemId: workflowOpsItemId }),
                        });
                        const data = (await r.json().catch(() => ({}))) as {
                          error?: string;
                          synced?: boolean;
                          logs?: string[];
                        };
                        if (!r.ok) {
                          setWarmSyncHint(data.error || `Request failed (${r.status}).`);
                          console.warn("[TimMessagesPanel] sync-warm-person", data);
                          return;
                        }
                        if (!data.synced) {
                          const tail = Array.isArray(data.logs)
                            ? data.logs.slice(-2).join(" ")
                            : "";
                          setWarmSyncHint(
                            tail ||
                              "Could not infer a person name from saved notes. Add a line like Name: First Last or put the full name alone on the first line."
                          );
                        }
                        await refreshQueue();
                      } finally {
                        setSyncingWarmContact(false);
                      }
                    }}
                    className="mt-2 text-[10px] px-2.5 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)]/40 disabled:opacity-50"
                  >
                    {syncingWarmContact ? "Saving…" : "Save contact to CRM from intake notes"}
                  </button>
                </div>
              ) : null}
              {isInputStage ? (
                <TimIntakeWorkspace
                  task={selected}
                  resolving={resolving === workflowOpsItemId}
                  headerDetail={timPersonHeaderDetail}
                  titleAccessory={
                    <TimWorkQueueIdsAccessory itemId={selected.itemId} sourceId={selected.sourceId} />
                  }
                  confirmedWorkflowActions={timArtifactHeaderActions}
                  onSubmitInput={async (notes) => {
                    await handleResolve(workflowOpsItemId, "input", notes);
                  }}
                />
              ) : (
                <>
                {resolveHint ? (
                  <div className="shrink-0 mb-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2">
                    <p className="text-[11px] text-[var(--text-chat-body)] leading-snug">{resolveHint}</p>
                    <button
                      type="button"
                      onClick={() => setResolveHint(null)}
                      className="mt-1.5 text-[10px] text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}
                {selected.waitingFollowUp ? (
                  <div className="shrink-0 mb-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2">
                    <p className="text-[11px] font-medium text-[var(--text-chat-body)]">
                      Messaged — waiting for follow-up
                    </p>
                    <p className="text-[10px] text-[var(--text-secondary)] mt-1 leading-snug">
                      Next <strong>message draft</strong> (bump / nudge) is scheduled when the due date hits
                      (about {WARM_OUTREACH_MESSAGE_FOLLOW_UP_DAYS} days after send) and opens automatically, or
                      start it now.
                    </p>
                    <button
                      type="button"
                      disabled={resolving === workflowOpsItemId}
                      onClick={() => handleResolve(workflowOpsItemId, "approve")}
                      className="mt-2 text-[10px] px-2.5 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)]/40 disabled:opacity-50"
                    >
                      {resolving === workflowOpsItemId ? "Starting…" : "Start follow-up early"}
                    </button>
                  </div>
                ) : null}
                {useLinkedInInboxIntakeWorkspace ? (
                  <div className="flex-1 min-h-0 min-w-0">
                    <TimLinkedInInboxIntakeWorkspace
                      task={{
                        itemId: workflowOpsItemId,
                        workflowId: selected.workflowId,
                        workflowName: selected.workflowName,
                        stage: selected.stage,
                        stageLabel: selected.stageLabel,
                        humanAction: selected.humanAction,
                        workflowType: selected.workflowType,
                        sourceId: selected.sourceId as string,
                      }}
                      resolving={resolving === workflowOpsItemId}
                      onSubmitApprove={async (notes) => {
                        await handleResolve(workflowOpsItemId, "approve", notes);
                      }}
                      onMoved={() => void refreshQueue()}
                      headerDetail={timPersonHeaderDetail}
                      titleAccessory={
                        <TimWorkQueueIdsAccessory itemId={selected.itemId} sourceId={selected.sourceId} />
                      }
                    />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 min-w-0">
                    <ArtifactViewer
                      key={`${workflowOpsItemId}-${selected.stage}`}
                      variant="inline"
                      alwaysShowArtifactTabs
                      allWorkflowArtifacts
                      showArtifactChat={false}
                      showArtifactFooter={false}
                      pollArtifactsMs={5000}
                      linkedInDmBodyStages={
                        selected.workflowType === "warm-outreach" ||
                        selected.workflowType === "linkedin-outreach"
                          ? ["MESSAGE_DRAFT", "REPLY_DRAFT", "REPLIED"]
                          : undefined
                      }
                      contactFirstName={selected.contactFirstName ?? null}
                      showLinkedInInboundBackfillButton={
                        selected.workflowType === "warm-outreach" ||
                        selected.workflowType === "linkedin-outreach"
                      }
                      workflowItemId={workflowOpsItemId}
                      itemType={selected.itemType === "person" ? "person" : "content"}
                      title={selected.workflowName}
                      titleAccessory={
                        <TimWorkQueueIdsAccessory itemId={selected.itemId} sourceId={selected.sourceId} />
                      }
                      headerDetail={timPersonHeaderDetail}
                      agentId={selected.ownerAgent || "tim"}
                      onSubmitTask={
                        timShowsArtifactSubmit(selected)
                          ? async () => {
                              await handleResolve(workflowOpsItemId, "approve");
                            }
                          : undefined
                      }
                      confirmedWorkflowActions={timArtifactHeaderActions}
                      onActiveArtifactChange={setFocusedArtifact}
                      reportTimLinkedInThread={
                        selected.workflowType === "warm-outreach" ||
                        selected.workflowType === "linkedin-outreach"
                      }
                      onWarmOutreachThreadTranscriptChange={setLinkedInThreadTranscript}
                      onClose={() => setSelectedId(null)}
                    />
                  </div>
                )}
                </>
              )}
              </>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6">
              <p className="text-sm text-[var(--text-tertiary)] text-center">
                Select a message to open the workspace.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
