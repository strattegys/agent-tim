"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  /** Warm-outreach MESSAGED — visible in Tim’s list but not an actionable draft submit */
  waitingFollowUp?: boolean;
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
    task.workflowType === "linkedin-outreach"
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

function messageAffiliationLine(t: MessagingTask): string {
  if (!t.packageId) {
    if (t.workflowName?.trim()) return `General · ${t.workflowName.trim()}`;
    return "General";
  }
  const num =
    t.packageNumber != null && !Number.isNaN(t.packageNumber) ? `#${t.packageNumber} ` : "";
  const pkg = `${num}${(t.packageName && t.packageName.trim()) || "Package"}`.trim();
  const wf = t.workflowName?.trim() || "Workflow";
  return `${pkg} · ${wf}`;
}

type TimQueueFilter =
  | { type: "all" }
  | { type: "workflow"; workflowType: string }
  | { type: "package"; packageId: string };

function taskMatchesQueueFilter(task: MessagingTask, f: TimQueueFilter): boolean {
  if (f.type === "all") return true;
  if (f.type === "workflow") return task.workflowType === f.workflowType;
  if (f.type === "package") return task.packageId === f.packageId;
  return true;
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
    default:
      return wt.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Other";
  }
}

/** Shown only when `npm run dev` / Docker dev set this (see package.json). */
const IS_LOCALDEV_UI =
  typeof process.env.NEXT_PUBLIC_CC_RUNTIME_LABEL === "string" &&
  process.env.NEXT_PUBLIC_CC_RUNTIME_LABEL.trim().toUpperCase() === "LOCALDEV";

/** Background refresh; initial load still shows the full-screen spinner. */
const POLL_INTERVAL_MS = 30_000;
const POLL_INTERVAL_HIDDEN_MS = 120_000;
/** Matches server default for GET human-tasks (ownerAgent=tim, non-summary). */
const TIM_QUEUE_PAGE = 80;

function mapRawToMessagingTask(t: Record<string, unknown>): MessagingTask {
  return {
    itemId: String(t.itemId),
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
    waitingFollowUp: Boolean(t.waitingFollowUp),
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

function timTasksFingerprint(
  list: Array<{
    itemId: string;
    stage: string;
    itemTitle: string;
    stageLabel: string;
    humanAction: string;
    workflowId: string;
    dueDate: string | null;
    waitingFollowUp: boolean;
    contactLinkedinPublicUrl?: string | null;
    contactLinkedinMemberId?: string | null;
    contactPrimaryEmail?: string | null;
  }>
): string {
  return list
    .map(
      (t) =>
        `${t.itemId}\t${t.stage}\t${t.itemTitle}\t${t.stageLabel}\t${t.humanAction}\t${t.workflowId}\t${t.dueDate ?? ""}\t${t.waitingFollowUp ? 1 : 0}\t${t.contactLinkedinPublicUrl ?? ""}\t${t.contactLinkedinMemberId ?? ""}\t${t.contactPrimaryEmail ?? ""}`
    )
    .join("\n");
}

function TimQueueItemRow({
  task,
  active,
  onSelect,
}: {
  task: MessagingTask;
  active: boolean;
  onSelect: () => void;
}) {
  const secondary = timQueueCardSecondaryLine(task);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`w-full text-left rounded-lg px-3 py-2.5 border transition-colors ${
        active
          ? "border-[var(--accent-green)]/80 bg-[var(--accent-green)]/14 shadow-sm ring-2 ring-inset ring-[var(--accent-green)]/45"
          : "border-[var(--border-color)] bg-[var(--bg-primary)]/90 hover:border-[var(--text-tertiary)]/55 hover:bg-[var(--bg-primary)]"
      }`}
    >
      <div
        className={`line-clamp-2 text-[12px] leading-relaxed break-words ${active ? "font-semibold text-[var(--text-primary)]" : "font-semibold text-[var(--text-chat-body)]"}`}
      >
        {timQueueCardPrimaryTitle(task)}
      </div>
      {secondary ? (
        <div className="text-[10px] text-[var(--text-tertiary)] line-clamp-2 break-words mt-1.5 leading-snug">
          {secondary}
        </div>
      ) : null}
      <div className="text-[9px] text-[var(--text-secondary)] truncate mt-1.5 leading-tight">
        {messageAffiliationLine(task)}
      </div>
    </button>
  );
}

export default function TimMessagesPanel({
  embedded = false,
  queueTab,
  onWorkSelectionChange,
}: {
  embedded?: boolean;
  /**
   * When set (e.g. from `TimAgentPanel` work tabs), only that queue is listed and selectable.
   * When omitted, both Active and Pending sections render in one sidebar (standalone layout).
   */
  queueTab?: "active" | "pending";
  /** Lets main Tim chat include the selected queue row as ephemeral context. */
  onWorkSelectionChange?: (selection: TimWorkQueueSelection | null) => void;
}) {
  const [tasks, setTasks] = useState<MessagingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [syncingWarmContact, setSyncingWarmContact] = useState(false);
  const [warmSyncHint, setWarmSyncHint] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<TimQueueFilter>({ type: "all" });
  const [resolveHint, setResolveHint] = useState<string | null>(null);
  const [queueHasMore, setQueueHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const mountedRef = useRef(true);
  const lastTasksFingerprintRef = useRef<string>("");
  const loadMoreNextRef = useRef<number | null>(null);
  const tabVisible = useDocumentVisible();

  const fetchTasks = useCallback((opts?: { append?: boolean; silent?: boolean }): Promise<void> => {
    const append = Boolean(opts?.append);
    const silent = Boolean(opts?.silent);
    const offset =
      append && loadMoreNextRef.current != null ? loadMoreNextRef.current : 0;

    if (!append && !silent && mountedRef.current) setLoading(true);
    if (append && mountedRef.current) setLoadingMore(true);

    const qs = new URLSearchParams({
      ownerAgent: "tim",
      messagingOnly: "1",
      limit: String(TIM_QUEUE_PAGE),
      offset: String(offset),
    });

    return fetch(`/api/crm/human-tasks?${qs.toString()}`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) {
          const snippet = (await r.text()).slice(0, 120);
          console.warn("[TimMessagesPanel] human-tasks", r.status, snippet);
          if (mountedRef.current) {
            setLoadError(`Could not load queue (HTTP ${r.status}).`);
            lastTasksFingerprintRef.current = "";
            setTasks([]);
            setQueueHasMore(false);
            loadMoreNextRef.current = null;
          }
          return null;
        }
        if (mountedRef.current) setLoadError(null);
        return r.json();
      })
      .then((data) => {
        if (data == null) return;
        if (data.error) console.warn("[TimMessagesPanel] human-tasks API:", data.error);
        const list = Array.isArray(data.tasks) ? data.tasks : [];
        if (mountedRef.current) {
          const next = list.map((t: Record<string, unknown>) => mapRawToMessagingTask(t));
          const nextOff = (data as { nextOffset?: unknown }).nextOffset;
          loadMoreNextRef.current = typeof nextOff === "number" ? nextOff : null;
          setQueueHasMore(Boolean((data as { hasMore?: unknown }).hasMore));

          if (append) {
            setTasks((prev) => {
              const m = new Map(prev.map((x) => [x.itemId, x]));
              for (const t of next) m.set(t.itemId, t);
              return [...m.values()];
            });
          } else {
            const fp = timTasksFingerprint(next);
            if (fp !== lastTasksFingerprintRef.current) {
              lastTasksFingerprintRef.current = fp;
              setTasks(next);
            }
          }
        }
      })
      .catch((e) => {
        console.warn("[TimMessagesPanel] human-tasks fetch failed:", e);
        if (mountedRef.current) {
          setLoadError("Network error loading queue.");
          lastTasksFingerprintRef.current = "";
          setTasks([]);
          setQueueHasMore(false);
          loadMoreNextRef.current = null;
        }
      })
      .finally(() => {
        if (!mountedRef.current) return;
        if (append) setLoadingMore(false);
        else if (!silent) setLoading(false);
      });
  }, []);

  const loadMoreTasks = useCallback(() => {
    if (!queueHasMore || loadingMore || loadMoreNextRef.current == null) return;
    void fetchTasks({ append: true });
  }, [fetchTasks, queueHasMore, loadingMore]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchTasks();
    const silentRefresh = () => void fetchTasks({ silent: true });
    const ms = tabVisible ? POLL_INTERVAL_MS : POLL_INTERVAL_HIDDEN_MS;
    const interval = setInterval(silentRefresh, ms);
    const u1 = panelBus.on("workflow_items", () => void fetchTasks({ silent: true }));
    const u2 = panelBus.on("package_manager", () => void fetchTasks({ silent: true }));
    const u3 = panelBus.on("tim_human_task_progress", () => void fetchTasks({ silent: true }));
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchTasks({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      u1();
      u2();
      u3();
    };
  }, [fetchTasks, tabVisible]);

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [tasks]
  );
  const activeQueue = useMemo(
    () => sortedTasks.filter((t) => !t.waitingFollowUp),
    [sortedTasks]
  );
  const pendingQueue = useMemo(
    () => sortedTasks.filter((t) => t.waitingFollowUp),
    [sortedTasks]
  );

  const filteredActiveQueue = useMemo(
    () => activeQueue.filter((t) => taskMatchesQueueFilter(t, queueFilter)),
    [activeQueue, queueFilter]
  );
  const filteredPendingQueue = useMemo(
    () => pendingQueue.filter((t) => taskMatchesQueueFilter(t, queueFilter)),
    [pendingQueue, queueFilter]
  );

  const workflowFilterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of sortedTasks) {
      if (t.workflowType) set.add(t.workflowType);
    }
    return [...set].sort();
  }, [sortedTasks]);

  const packageFilterOptions = useMemo(() => {
    const m = new Map<string, { packageId: string; packageName: string; count: number }>();
    for (const t of sortedTasks) {
      if (!t.packageId) continue;
      const prev = m.get(t.packageId);
      if (prev) prev.count += 1;
      else
        m.set(t.packageId, {
          packageId: t.packageId,
          packageName: (t.packageName && t.packageName.trim()) || "Package",
          count: 1,
        });
    }
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  }, [sortedTasks]);

  const visibleQueue = useMemo(() => {
    if (queueTab === "active") return filteredActiveQueue;
    if (queueTab === "pending") return filteredPendingQueue;
    return null;
  }, [queueTab, filteredActiveQueue, filteredPendingQueue]);

  useEffect(() => {
    if (queueFilter.type === "workflow" && !workflowFilterOptions.includes(queueFilter.workflowType)) {
      setQueueFilter({ type: "all" });
      return;
    }
    if (queueFilter.type === "package") {
      const stillHere = sortedTasks.some((t) => t.packageId === queueFilter.packageId);
      if (!stillHere) setQueueFilter({ type: "all" });
    }
  }, [queueFilter, workflowFilterOptions, sortedTasks]);

  useEffect(() => {
    if (visibleQueue) {
      if (visibleQueue.length === 0) {
        setSelectedId(null);
        return;
      }
      setSelectedId((prev) =>
        prev && visibleQueue.some((t) => t.itemId === prev)
          ? prev
          : visibleQueue[0]?.itemId ?? null
      );
      return;
    }
    const ordered = [...filteredActiveQueue, ...filteredPendingQueue];
    if (ordered.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) =>
      prev && ordered.some((t) => t.itemId === prev)
        ? prev
        : filteredActiveQueue[0]?.itemId ?? filteredPendingQueue[0]?.itemId ?? null
    );
  }, [visibleQueue, filteredActiveQueue, filteredPendingQueue]);

  useEffect(() => {
    setWarmSyncHint(null);
    setResolveHint(null);
  }, [selectedId]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    if (visibleQueue) {
      return visibleQueue.find((t) => t.itemId === selectedId) ?? null;
    }
    return (
      filteredActiveQueue.find((t) => t.itemId === selectedId) ??
      filteredPendingQueue.find((t) => t.itemId === selectedId) ??
      null
    );
  }, [visibleQueue, filteredActiveQueue, filteredPendingQueue, selectedId]);

  const isInputStage = Boolean(selected && INPUT_ONLY_STAGES.has(selected.stage));

  const timPersonHeaderDetail =
    selected &&
    (selected.itemType === "person" || selected.itemType === WARM_DISCOVERY_SOURCE_TYPE) &&
    (selected.workflowType === "warm-outreach" ||
      selected.workflowType === "linkedin-outreach" ||
      selected.workflowType === "linkedin-general-inbox" ||
      selected.workflowType === "linkedin-connection-intake")
      ? timPersonWorkflowHeaderDetail(selected)
      : undefined;

  const useLinkedInInboxIntakeWorkspace = Boolean(
    selected &&
      selected.sourceId &&
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
  }, [selected, isInputStage, focusedArtifact, onWorkSelectionChange, linkedInThreadTranscript]);

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
        const taskRow = tasks.find((t) => t.itemId === itemId);
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
          await fetchTasks({ silent: true });
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
    [fetchTasks, resolving, tasks]
  );

  /** Header actions (ArtifactViewer top-right): warm-outreach steps + Reject when that transition is allowed. */
  const timArtifactHeaderActions = useMemo((): ArtifactConfirmedWorkflowAction[] | undefined => {
    if (!selected) return undefined;
    const id = selected.itemId;
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
  }, [selected, handleResolve]);

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
          <span className="text-xs font-medium text-[var(--text-chat-body)]">Tim work queues</span>
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
          className="w-[20%] min-w-[140px] max-w-[260px] shrink-0 flex flex-col border-r border-[var(--border-color)] bg-[var(--bg-secondary)]/60"
          aria-label={
            queueTab === "active"
              ? "Tim Active Work Queue"
              : queueTab === "pending"
                ? "Tim Pending Work Queue"
                : "Tim message queues"
          }
        >
          <div className="shrink-0 px-2.5 py-2 border-b border-[var(--border-color)]/80 space-y-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              {queueTab === "active"
                ? `Active · ${filteredActiveQueue.length}${queueFilter.type !== "all" && filteredActiveQueue.length !== activeQueue.length ? ` / ${activeQueue.length}` : ""}`
                : queueTab === "pending"
                  ? `Pending · ${filteredPendingQueue.length}${queueFilter.type !== "all" && filteredPendingQueue.length !== pendingQueue.length ? ` / ${pendingQueue.length}` : ""}`
                  : `Queues · ${sortedTasks.length}`}
            </span>
            {sortedTasks.length > 0 ? (
              <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Filter queue by type or package">
                <button
                  type="button"
                  onClick={() => setQueueFilter({ type: "all" })}
                  className={`text-[9px] px-2 py-0.5 rounded-full border shrink-0 transition-colors ${
                    queueFilter.type === "all"
                      ? "border-[var(--accent-green)]/60 bg-[var(--accent-green)]/15 text-[var(--text-primary)] font-medium"
                      : "border-[var(--border-color)] bg-[var(--bg-primary)]/80 text-[var(--text-secondary)] hover:border-[var(--text-tertiary)]/40"
                  }`}
                >
                  All
                </button>
                {workflowFilterOptions.map((wt) => (
                  <button
                    key={wt}
                    type="button"
                    onClick={() => setQueueFilter({ type: "workflow", workflowType: wt })}
                    className={`text-[9px] px-2 py-0.5 rounded-full border shrink-0 max-w-[9.5rem] truncate transition-colors ${
                      queueFilter.type === "workflow" && queueFilter.workflowType === wt
                        ? "border-[var(--accent-green)]/60 bg-[var(--accent-green)]/15 text-[var(--text-primary)] font-medium"
                        : "border-[var(--border-color)] bg-[var(--bg-primary)]/80 text-[var(--text-secondary)] hover:border-[var(--text-tertiary)]/40"
                    }`}
                    title={wt}
                  >
                    {workflowTypeFilterLabel(wt)}
                  </button>
                ))}
                {packageFilterOptions.map((p) => (
                  <button
                    key={p.packageId}
                    type="button"
                    onClick={() => setQueueFilter({ type: "package", packageId: p.packageId })}
                    className={`text-[9px] px-2 py-0.5 rounded-full border shrink-0 max-w-[10rem] truncate transition-colors ${
                      queueFilter.type === "package" && queueFilter.packageId === p.packageId
                        ? "border-[var(--accent-green)]/60 bg-[var(--accent-green)]/15 text-[var(--text-primary)] font-medium"
                        : "border-[var(--border-color)] bg-[var(--bg-primary)]/80 text-[var(--text-secondary)] hover:border-[var(--text-tertiary)]/40"
                    }`}
                    title={`${p.packageName} (${p.count})`}
                  >
                    {p.packageName.length > 20 ? `${p.packageName.slice(0, 18)}…` : p.packageName}
                    <span className="opacity-70 font-normal"> ·{p.count}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5 space-y-4">
            {queueTab === "active" ? (
              sortedTasks.length === 0 ? (
                <p className="text-[10px] text-[var(--text-tertiary)] text-center py-6 px-1">No tasks</p>
              ) : activeQueue.length === 0 ? (
                <p className="text-[10px] text-[var(--text-tertiary)] text-center py-6 px-1">
                  Nothing active — check <strong>Pending Work Queue</strong>.
                </p>
              ) : filteredActiveQueue.length === 0 ? (
                <p className="text-[10px] text-[var(--text-tertiary)] text-center py-6 px-1">
                  Nothing matches this filter. Try <strong>All</strong> or another package/type.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {filteredActiveQueue.map((task) => (
                    <TimQueueItemRow
                      key={task.itemId}
                      task={task}
                      active={task.itemId === selectedId}
                      onSelect={() => setSelectedId(task.itemId)}
                    />
                  ))}
                </div>
              )
            ) : queueTab === "pending" ? (
              sortedTasks.length === 0 ? (
                <p className="text-[10px] text-[var(--text-tertiary)] text-center py-6 px-1">No tasks</p>
              ) : pendingQueue.length === 0 ? (
                <p className="text-[10px] text-[var(--text-tertiary)] text-center py-6 px-1">
                  No pending items.
                </p>
              ) : filteredPendingQueue.length === 0 ? (
                <p className="text-[10px] text-[var(--text-tertiary)] text-center py-6 px-1">
                  Nothing matches this filter. Try <strong>All</strong> or another package/type.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {filteredPendingQueue.map((task) => (
                    <TimQueueItemRow
                      key={task.itemId}
                      task={task}
                      active={task.itemId === selectedId}
                      onSelect={() => setSelectedId(task.itemId)}
                    />
                  ))}
                </div>
              )
            ) : sortedTasks.length === 0 ? (
              <p className="text-[10px] text-[var(--text-tertiary)] text-center py-6 px-1">Queues empty</p>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="px-0.5 pb-0.5">
                    <span className="text-[10px] font-semibold text-[var(--text-primary)]">
                      Active ({filteredActiveQueue.length}
                      {queueFilter.type !== "all" && filteredActiveQueue.length !== activeQueue.length
                        ? ` / ${activeQueue.length}`
                        : ""}
                      )
                    </span>
                  </div>
                  {activeQueue.length === 0 ? (
                    <p className="text-[9px] text-[var(--text-tertiary)] px-0.5 py-1">None right now.</p>
                  ) : filteredActiveQueue.length === 0 ? (
                    <p className="text-[9px] text-[var(--text-tertiary)] px-0.5 py-1">
                      No rows for this filter.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {filteredActiveQueue.map((task) => (
                        <TimQueueItemRow
                          key={task.itemId}
                          task={task}
                          active={task.itemId === selectedId}
                          onSelect={() => setSelectedId(task.itemId)}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-2 pt-3 mt-1 border-t border-[var(--border-color)]/50">
                  <div className="px-0.5 pb-0.5">
                    <span className="text-[10px] font-medium text-[var(--text-chat-body)]">
                      Pending ({filteredPendingQueue.length}
                      {queueFilter.type !== "all" && filteredPendingQueue.length !== pendingQueue.length
                        ? ` / ${pendingQueue.length}`
                        : ""}
                      )
                    </span>
                  </div>
                  {pendingQueue.length === 0 ? (
                    <p className="text-[9px] text-[var(--text-tertiary)] px-0.5 py-1">None.</p>
                  ) : filteredPendingQueue.length === 0 ? (
                    <p className="text-[9px] text-[var(--text-tertiary)] px-0.5 py-1">
                      No rows for this filter.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {filteredPendingQueue.map((task) => (
                        <TimQueueItemRow
                          key={task.itemId}
                          task={task}
                          active={task.itemId === selectedId}
                          onSelect={() => setSelectedId(task.itemId)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            {queueHasMore ? (
              <div className="pt-3 px-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => loadMoreTasks()}
                  disabled={loadingMore}
                  className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-primary)]/60 px-2 py-1.5 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
                <p className="text-[8px] text-[var(--text-tertiary)] mt-1 leading-snug">
                  Polling refreshes the first page only; use Load more again if the list resets.
                </p>
              </div>
            ) : null}
          </div>
        </aside>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col p-2">
          {selected ? (
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
                          body: JSON.stringify({ itemId: selected.itemId }),
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
                        await fetchTasks({ silent: true });
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
                  resolving={resolving === selected.itemId}
                  headerDetail={timPersonHeaderDetail}
                  titleAccessory={
                    IS_LOCALDEV_UI ? (
                      <span
                        className="font-mono text-[10px] leading-tight text-[var(--text-tertiary)] select-all break-all opacity-90"
                        title="Workflow item id (_workflow_item.id) — copy for dev / agent context"
                      >
                        {selected.itemId}
                      </span>
                    ) : undefined
                  }
                  confirmedWorkflowActions={timArtifactHeaderActions}
                  onClose={() => setSelectedId(null)}
                  onSubmitInput={async (notes) => {
                    await handleResolve(selected.itemId, "input", notes);
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
                      disabled={resolving === selected.itemId}
                      onClick={() => handleResolve(selected.itemId, "approve")}
                      className="mt-2 text-[10px] px-2.5 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)]/40 disabled:opacity-50"
                    >
                      {resolving === selected.itemId ? "Starting…" : "Start follow-up early"}
                    </button>
                  </div>
                ) : null}
                {useLinkedInInboxIntakeWorkspace ? (
                  <div className="flex-1 min-h-0 min-w-0">
                    <TimLinkedInInboxIntakeWorkspace
                      task={{
                        itemId: selected.itemId,
                        workflowId: selected.workflowId,
                        workflowName: selected.workflowName,
                        stage: selected.stage,
                        stageLabel: selected.stageLabel,
                        humanAction: selected.humanAction,
                        workflowType: selected.workflowType,
                        sourceId: selected.sourceId as string,
                      }}
                      resolving={resolving === selected.itemId}
                      onSubmitApprove={async (notes) => {
                        await handleResolve(selected.itemId, "approve", notes);
                      }}
                      onMoved={() => void fetchTasks({ silent: true })}
                      headerDetail={timPersonHeaderDetail}
                      titleAccessory={
                        IS_LOCALDEV_UI ? (
                          <span
                            className="font-mono text-[10px] leading-tight text-[var(--text-tertiary)] select-all break-all opacity-90"
                            title="Workflow item id (_workflow_item.id) — copy for dev / agent context"
                          >
                            {selected.itemId}
                          </span>
                        ) : undefined
                      }
                      onClose={() => setSelectedId(null)}
                    />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 min-w-0">
                    <ArtifactViewer
                      key={`${selected.itemId}-${selected.stage}`}
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
                      workflowItemId={selected.itemId}
                      itemType={selected.itemType === "person" ? "person" : "content"}
                      title={selected.workflowName}
                      titleAccessory={
                        IS_LOCALDEV_UI ? (
                          <span
                            className="font-mono text-[10px] leading-tight text-[var(--text-tertiary)] select-all break-all opacity-90"
                            title="Workflow item id (_workflow_item.id) — copy for dev / agent context"
                          >
                            {selected.itemId}
                          </span>
                        ) : undefined
                      }
                      headerDetail={timPersonHeaderDetail}
                      agentId={selected.ownerAgent || "tim"}
                      onSubmitTask={
                        timShowsArtifactSubmit(selected)
                          ? async () => {
                              await handleResolve(selected.itemId, "approve");
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
