"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { panelBus } from "@/lib/events";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type { TimWorkQueueSelection } from "@/lib/tim-work-context";
import { WARM_OUTREACH_MESSAGE_FOLLOW_UP_DAYS } from "@/lib/warm-outreach-cadence";
import { isWarmOutreachPlaceholderJobTitle } from "@/lib/warm-outreach-researching-guard";
import ArtifactViewer, { type ArtifactConfirmedWorkflowAction } from "../shared/ArtifactViewer";
import TimIntakeWorkspace from "./TimIntakeWorkspace";

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
  contactCompany?: string | null;
  contactTitle?: string | null;
  /** Person row still Next/Contact in CRM — intake artifacts not applied */
  contactDbSyncPending?: boolean;
  contactLinkedinPublicUrl?: string | null;
  contactLinkedinMemberId?: string | null;
  contactPrimaryEmail?: string | null;
}

type WarmOutreachDailyProgress = {
  completed: number;
  target: number;
  datePacific: string;
  pacedDailyActive?: boolean;
  nextDiscoveryOpensAt?: string | null;
};

function formatNextWarmSlotPacific(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
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
    <div className="space-y-1.5 text-[10px] leading-snug max-w-full">
      {awaitingDetails ? (
        <p className="text-[9px] font-medium text-[var(--text-tertiary)] pb-1 border-b border-[var(--border-color)]/50">
          {task.workflowType === "linkedin-outreach"
            ? "LinkedIn outreach — awaiting contact details"
            : "Warm outreach — awaiting contact details"}
        </p>
      ) : null}
      <dl className="grid grid-cols-[3.25rem_1fr] gap-x-2 gap-y-0.5">
        <dt className="text-[var(--text-tertiary)]">Name</dt>
        <dd className="text-[var(--text-primary)] font-medium min-w-0 break-words">{name}</dd>
      </dl>
      {/* LinkedIn + email: always show when we have data (intake often stays in AWAITING_CONTACT until submit). */}
      <dl className="grid grid-cols-[3.25rem_1fr] gap-x-2 gap-y-0.5">
        <dt className="text-[var(--text-tertiary)] align-top pt-0.5">LinkedIn</dt>
        <dd className="min-w-0 space-y-1">
          {publicUrl ? (
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--text-secondary)] underline underline-offset-2 break-all block hover:text-[var(--text-primary)]"
            >
              Public profile
            </a>
          ) : null}
          {memberId ? (
            <span
              className="block font-mono text-[9px] text-[var(--text-secondary)] break-all"
              title="Unipile / LinkedIn API member id — used for send + inbound match when stored"
            >
              {memberId}
            </span>
          ) : null}
          {!hasAnyLinkedIn ? (
            awaitingDetails ? (
              <span className="text-[9px] text-[var(--text-tertiary)] leading-snug">
                Include a LinkedIn URL in your notes; it appears here after the contact is saved to CRM (or sync from
                intake).
              </span>
            ) : (
              <span className="text-[9px] text-[var(--text-secondary)]">
                Not set — add profile URL or ACoA… on the person in CRM (see migrate-person-linkedin-provider.sql).
              </span>
            )
          ) : null}
        </dd>
        {email ? (
          <>
            <dt className="text-[var(--text-tertiary)]">Email</dt>
            <dd className="min-w-0 break-all">
              <a
                href={`mailto:${email}`}
                className="text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
              >
                {email}
              </a>
            </dd>
          </>
        ) : null}
      </dl>
      <p className="text-[8px] text-[var(--text-tertiary)] leading-snug">
        Do these in order when you have a contact:
      </p>
      <dl className="grid grid-cols-[3.25rem_1fr] gap-x-2 gap-y-0.5">
        <dt className="text-[var(--text-tertiary)]">Company</dt>
        <dd className="text-[var(--text-chat-body)] min-w-0 break-words">{company}</dd>
        <dt className="text-[var(--text-tertiary)]">Title</dt>
        <dd className="text-[var(--text-chat-body)] min-w-0 break-words">{jobTitle}</dd>
      </dl>
    </div>
  );
}

function timShowsArtifactSubmit(task: MessagingTask): boolean {
  if (task.waitingFollowUp) return false;
  return (
    task.stage === "MESSAGE_DRAFT" ||
    task.stage === "REPLY_DRAFT" ||
    task.stage === "LINKEDIN_INBOUND"
  );
}

/** Queue card primary line: warm-outreach shows workflow + step in the title. */
function timQueueCardPrimaryTitle(task: MessagingTask): string {
  if (task.workflowType === "warm-outreach") {
    const step = task.stageLabel?.trim() || task.stage.replace(/_/g, " ");
    return `Warm Outreach · ${step}`;
  }
  if (task.workflowType === "linkedin-general-inbox") {
    const step = task.stageLabel?.trim() || task.stage.replace(/_/g, " ");
    return `LinkedIn inbox · ${step}`;
  }
  return task.itemTitle;
}

/** Second line under the primary title (contact / content name for warm-outreach). */
function timQueueCardSecondaryLine(task: MessagingTask): string | null {
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
      className={`w-full text-left rounded-md px-2 py-1.5 border transition-colors ${
        active
          ? "border-[var(--border-color)] bg-[var(--bg-secondary)]"
          : "border-transparent bg-[var(--bg-primary)]/80 hover:border-[var(--border-color)]"
      }`}
    >
      <div className="text-[10px] font-medium text-[var(--text-chat-body)] truncate">
        {timQueueCardPrimaryTitle(task)}
      </div>
      {secondary ? (
        <div className="text-[9px] text-[var(--text-tertiary)] truncate">{secondary}</div>
      ) : null}
      <div className="text-[9px] text-[var(--text-secondary)] truncate mt-0.5 leading-tight">
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
  const [warmOutreachDaily, setWarmOutreachDaily] = useState<WarmOutreachDailyProgress | null>(null);
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
        const wod = (data as { warmOutreachDaily?: unknown }).warmOutreachDaily;
        if (
          wod &&
          typeof wod === "object" &&
          wod !== null &&
          typeof (wod as WarmOutreachDailyProgress).completed === "number" &&
          typeof (wod as WarmOutreachDailyProgress).target === "number" &&
          typeof (wod as WarmOutreachDailyProgress).datePacific === "string"
        ) {
          if (mountedRef.current) {
            const w = wod as WarmOutreachDailyProgress & {
              pacedDailyActive?: unknown;
              nextDiscoveryOpensAt?: unknown;
            };
            setWarmOutreachDaily({
              completed: w.completed,
              target: w.target,
              datePacific: w.datePacific,
              pacedDailyActive: Boolean(w.pacedDailyActive),
              nextDiscoveryOpensAt:
                typeof w.nextDiscoveryOpensAt === "string" ? w.nextDiscoveryOpensAt : null,
            });
          }
        } else if (mountedRef.current && !append) {
          setWarmOutreachDaily(null);
        }
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

  const visibleQueue = useMemo(() => {
    if (queueTab === "active") return activeQueue;
    if (queueTab === "pending") return pendingQueue;
    return null;
  }, [queueTab, activeQueue, pendingQueue]);

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
    const ordered = [...activeQueue, ...pendingQueue];
    if (ordered.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) =>
      prev && ordered.some((t) => t.itemId === prev)
        ? prev
        : activeQueue[0]?.itemId ?? pendingQueue[0]?.itemId ?? null
    );
  }, [visibleQueue, activeQueue, pendingQueue]);

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
      activeQueue.find((t) => t.itemId === selectedId) ??
      pendingQueue.find((t) => t.itemId === selectedId) ??
      null
    );
  }, [visibleQueue, activeQueue, pendingQueue, selectedId]);

  const isInputStage = Boolean(selected && INPUT_ONLY_STAGES.has(selected.stage));

  const timPersonHeaderDetail =
    selected &&
    selected.itemType === "person" &&
    (selected.workflowType === "warm-outreach" || selected.workflowType === "linkedin-outreach")
      ? timPersonWorkflowHeaderDetail(selected)
      : undefined;

  const [focusedArtifact, setFocusedArtifact] = useState<{
    stage: string;
    label: string;
  } | null>(null);

  useEffect(() => {
    setFocusedArtifact(null);
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
    });
  }, [selected, isInputStage, focusedArtifact, onWorkSelectionChange]);

  useEffect(() => {
    return () => {
      onWorkSelectionChange?.(null);
    };
  }, [onWorkSelectionChange]);

  const handleResolve = useCallback(
    async (
      itemId: string,
      action: "approve" | "reject" | "input" | "replied" | "ended" | "undo_replied",
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
            ...(action === "undo_replied" ? { confirmUndo: true } : {}),
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
      if (selected.stage === "REPLY_DRAFT" || selected.stage === "REPLIED") {
        actions.push({
          id: "undo-replied",
          label: "Undo mistaken Replied",
          variant: "danger",
          confirmMessage:
            "Remove Replied / Reply-draft artifacts for this item and return to Messaged with a new follow-up date? Only if you clicked Replied by mistake. This deletes reply-thread artifacts on this workflow item.",
          onConfirm: () => handleResolve(id, "undo_replied"),
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
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 leading-snug">
            In Command Central, open the <strong>work panel</strong> (list icon under Tim’s header) and use the{" "}
            <strong>Active Work Queue</strong> / <strong>Pending Work Queue</strong> tabs. Here (standalone) both queues
            are listed below.
            Active needs a decision now; pending is waiting on timing or follow-up.
          </p>
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
          <div className="shrink-0 px-2 py-1.5 border-b border-[var(--border-color)]/80 space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              {queueTab === "active"
                ? `Active Work Queue · ${activeQueue.length}`
                : queueTab === "pending"
                  ? `Pending Work Queue · ${pendingQueue.length}`
                  : `Queues · ${sortedTasks.length} total`}
            </span>
            {warmOutreachDaily && warmOutreachDaily.target > 0 && queueTab !== "pending" ? (
              <div className="rounded border border-[var(--border-color)]/60 bg-[var(--bg-primary)]/40 px-1.5 py-1">
                <p className="text-[9px] font-medium text-[var(--text-chat-body)] leading-tight">
                  Today (PT): {warmOutreachDaily.completed} / {warmOutreachDaily.target} contact intakes
                </p>
                <p className="text-[8px] text-[var(--text-tertiary)] leading-snug mt-0.5">
                  Target sums <code className="text-[8px]">discoveriesPerDay</code> on each active warm-outreach
                  package. Submit notes on a discovery slot to count.
                </p>
                {warmOutreachDaily.completed < warmOutreachDaily.target ? (
                  <p className="text-[8px] text-[var(--text-secondary)] mt-0.5 leading-snug">
                    {warmOutreachDaily.target - warmOutreachDaily.completed} left to hit today’s goal.
                  </p>
                ) : (
                  <p className="text-[8px] text-[var(--text-tertiary)] mt-0.5">Daily intake goal met.</p>
                )}
                {warmOutreachDaily.pacedDailyActive && warmOutreachDaily.nextDiscoveryOpensAt ? (
                  <p className="text-[8px] text-[var(--text-secondary)] mt-0.5 leading-snug">
                    Paced weekdays: next discovery slot can spawn after{" "}
                    <strong>{formatNextWarmSlotPacific(warmOutreachDaily.nextDiscoveryOpensAt)} PT</strong>{" "}
                    (cron checks ~every 30 min).
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-3">
            {queueTab === "active" ? (
              sortedTasks.length === 0 ? (
                <p className="text-[10px] text-[var(--text-tertiary)] text-center py-6 px-1">No tasks</p>
              ) : activeQueue.length === 0 ? (
                <p className="text-[10px] text-[var(--text-tertiary)] text-center py-6 px-1">
                  Nothing active — check <strong>Pending Work Queue</strong>.
                </p>
              ) : (
                <div className="space-y-1">
                  <div className="px-0.5">
                    <p className="text-[8px] text-[var(--text-tertiary)] leading-snug">
                      Drafts, intake, review — needs your attention now.
                    </p>
                  </div>
                  {activeQueue.map((task) => (
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
              pendingQueue.length === 0 ? (
                <p className="text-[10px] text-[var(--text-tertiary)] text-center py-6 px-1">
                  No pending items — waiting rows appear after you message someone and the follow-up window hasn’t
                  opened yet.
                </p>
              ) : (
                <div className="space-y-1">
                  <div className="px-0.5">
                    <p className="text-[8px] text-[var(--text-tertiary)] leading-snug">
                      Sent or waiting — next step opens on schedule (or start follow-up early in the workspace).
                    </p>
                  </div>
                  {pendingQueue.map((task) => (
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
                <div className="space-y-1">
                  <div className="px-0.5">
                    <span className="text-[10px] font-semibold text-[var(--text-primary)]">
                      Active work queue ({activeQueue.length})
                    </span>
                    <p className="text-[8px] text-[var(--text-tertiary)] leading-snug mt-0.5">
                      Needs your attention now (drafts, intake, review).
                    </p>
                  </div>
                  {activeQueue.length === 0 ? (
                    <p className="text-[9px] text-[var(--text-tertiary)] px-0.5 py-1">None right now.</p>
                  ) : (
                    activeQueue.map((task) => (
                      <TimQueueItemRow
                        key={task.itemId}
                        task={task}
                        active={task.itemId === selectedId}
                        onSelect={() => setSelectedId(task.itemId)}
                      />
                    ))
                  )}
                </div>
                <div className="space-y-1 pt-1 border-t border-[var(--border-color)]/50">
                  <div className="px-0.5">
                    <span className="text-[10px] font-medium text-[var(--text-chat-body)]">
                      Pending Work Queue ({pendingQueue.length})
                    </span>
                    <p className="text-[8px] text-[var(--text-tertiary)] leading-snug mt-0.5">
                      Sent or waiting — next step opens on schedule (or start follow-up early from the workspace).
                    </p>
                  </div>
                  {pendingQueue.length === 0 ? (
                    <p className="text-[9px] text-[var(--text-tertiary)] px-0.5 py-1">None.</p>
                  ) : (
                    pendingQueue.map((task) => (
                      <TimQueueItemRow
                        key={task.itemId}
                        task={task}
                        active={task.itemId === selectedId}
                        onSelect={() => setSelectedId(task.itemId)}
                      />
                    ))
                  )}
                </div>
              </>
            )}
            {queueHasMore ? (
              <div className="pt-2 px-0.5 shrink-0">
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
                  documentHeaderDetail={timPersonHeaderDetail}
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
                <div className="flex-1 min-h-0 min-w-0">
                  <ArtifactViewer
                    key={`${selected.itemId}-${selected.stage}`}
                    variant="inline"
                    alwaysShowArtifactTabs
                    allWorkflowArtifacts
                    showArtifactChat={false}
                    showArtifactFooter={false}
                    pollArtifactsMs={30000}
                    linkedInDmBodyStages={
                      selected.workflowType === "warm-outreach" ||
                      selected.workflowType === "linkedin-outreach"
                        ? ["MESSAGE_DRAFT", "REPLY_DRAFT"]
                        : undefined
                    }
                    workflowItemId={selected.itemId}
                    itemType={selected.itemType === "person" ? "person" : "content"}
                    title={selected.workflowName}
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
                    onClose={() => setSelectedId(null)}
                  />
                </div>
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
