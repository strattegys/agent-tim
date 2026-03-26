"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { panelBus } from "@/lib/events";
import type { TimWorkQueueSelection } from "@/lib/tim-work-context";
import { WARM_OUTREACH_MESSAGE_FOLLOW_UP_DAYS } from "@/lib/warm-outreach-cadence";
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
  "MESSAGED",
  "REPLY_DRAFT",
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

/** Renders under the “Warm Outreach” + document icon title (ArtifactViewer + intake). */
function warmOutreachPersonHeaderDetail(task: MessagingTask) {
  const name = task.contactSlotOpen
    ? "Add contact (intake below)"
    : task.contactName?.trim() || "—";
  const company = task.contactCompany?.trim() || "—";
  const title = task.contactTitle?.trim() || "—";
  return (
    <dl className="grid grid-cols-[3.25rem_1fr] gap-x-2 gap-y-0.5 text-[10px] leading-snug max-w-full">
      <dt className="text-[var(--text-tertiary)]">Name</dt>
      <dd className="text-[var(--text-primary)] font-medium min-w-0 break-words">{name}</dd>
      <dt className="text-[var(--text-tertiary)]">Company</dt>
      <dd className="text-[var(--text-primary)] min-w-0 break-words">{company}</dd>
      <dt className="text-[var(--text-tertiary)]">Title</dt>
      <dd className="text-[var(--text-primary)] min-w-0 break-words">{title}</dd>
    </dl>
  );
}

function timShowsArtifactSubmit(task: MessagingTask): boolean {
  if (task.waitingFollowUp) return false;
  return task.stage === "MESSAGE_DRAFT" || task.stage === "REPLY_DRAFT";
}

/** Queue card primary line: warm-outreach shows workflow + step in the title. */
function timQueueCardPrimaryTitle(task: MessagingTask): string {
  if (task.workflowType === "warm-outreach") {
    const step = task.stageLabel?.trim() || task.stage.replace(/_/g, " ");
    return `Warm Outreach · ${step}`;
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

const POLL_INTERVAL = 5000;

function timSecondaryActionsVisible(task: MessagingTask): boolean {
  if (task.stage === "MESSAGED" && task.workflowType === "warm-outreach") return true;
  if (task.stage === "REPLY_DRAFT" && task.workflowType === "warm-outreach") return true;
  return !NO_REJECT_STAGES.has(task.stage);
}

function TimTaskActionBar({
  task,
  resolving,
  onResolve,
}: {
  task: MessagingTask;
  resolving: string | null;
  onResolve: (itemId: string, action: "approve" | "reject" | "input" | "replied" | "ended") => void;
}) {
  return (
    <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-t border-[var(--border-color)] bg-[var(--bg-secondary)]">
      <span className="text-[10px] text-[var(--text-tertiary)] mr-auto hidden sm:inline">
        {task.humanAction}
      </span>
      <div className="flex flex-wrap gap-1.5 justify-end w-full sm:w-auto">
        {!NO_REJECT_STAGES.has(task.stage) && (
          <button
            type="button"
            onClick={() => onResolve(task.itemId, "reject")}
            disabled={resolving === task.itemId}
            className="text-[10px] px-2.5 py-1 rounded-md border border-red-500/20 bg-red-500/5 text-red-400/90 disabled:opacity-50"
          >
            Reject
          </button>
        )}
      </div>
    </div>
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
  const [tasks, setTasks] = useState<MessagingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [syncingWarmContact, setSyncingWarmContact] = useState(false);
  const [warmSyncHint, setWarmSyncHint] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [warmOutreachDaily, setWarmOutreachDaily] = useState<WarmOutreachDailyProgress | null>(null);
  const mountedRef = useRef(true);

  const fetchTasks = useCallback((): Promise<void> => {
    return fetch("/api/crm/human-tasks?ownerAgent=tim", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) {
          const snippet = (await r.text()).slice(0, 120);
          console.warn("[TimMessagesPanel] human-tasks", r.status, snippet);
          if (mountedRef.current) {
            setLoadError(`Could not load queue (HTTP ${r.status}).`);
            setTasks([]);
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
        } else if (mountedRef.current) {
          setWarmOutreachDaily(null);
        }
        if (mountedRef.current) {
          setTasks(
            list.map((t: Record<string, unknown>) => ({
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
            }))
          );
        }
      })
      .catch((e) => {
        console.warn("[TimMessagesPanel] human-tasks fetch failed:", e);
        if (mountedRef.current) {
          setLoadError("Network error loading queue.");
          setTasks([]);
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchTasks();
    const interval = setInterval(fetchTasks, POLL_INTERVAL);
    const u1 = panelBus.on("workflow_items", fetchTasks);
    const u2 = panelBus.on("package_manager", fetchTasks);
    const u3 = panelBus.on("tim_human_task_progress", fetchTasks);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      u1();
      u2();
      u3();
    };
  }, [fetchTasks]);

  const queue = useMemo(
    () => [...tasks].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [tasks]
  );

  useEffect(() => {
    if (queue.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => (prev && queue.some((t) => t.itemId === prev) ? prev : queue[0].itemId));
  }, [queue]);

  useEffect(() => {
    setWarmSyncHint(null);
  }, [selectedId]);

  const selected = useMemo(
    () => (selectedId ? queue.find((t) => t.itemId === selectedId) ?? null : null),
    [queue, selectedId]
  );

  const isInputStage = Boolean(selected && INPUT_ONLY_STAGES.has(selected.stage));

  const warmPersonHeaderDetail =
    selected && selected.workflowType === "warm-outreach" && selected.itemType === "person"
      ? warmOutreachPersonHeaderDetail(selected)
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
          if (data.logs?.length) pushLogs(data.logs);
          panelBus.emit("tim_human_task_progress");
          await new Promise((r) => setTimeout(r, 350));
          await fetchTasks();
        } else {
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

  const timWarmHeaderActions = useMemo((): ArtifactConfirmedWorkflowAction[] | undefined => {
    if (!selected || selected.workflowType !== "warm-outreach") return undefined;
    const id = selected.itemId;
    const actions: ArtifactConfirmedWorkflowAction[] = [];
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
          <span className="text-xs font-semibold text-[var(--text-primary)]">Work queue</span>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 leading-snug">
            Pick a task on the left. One workspace shows package brief tabs, drafts, and Tim chat — no side column.
          </p>
          {loadError && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">{loadError}</p>
          )}
        </div>
      )}
      {embedded && loadError && (
        <div className="shrink-0 px-3 py-1.5 border-b border-amber-500/20 bg-amber-500/5">
          <p className="text-[10px] text-amber-600 dark:text-amber-400">{loadError}</p>
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-row">
        <aside
          className="w-[20%] min-w-[140px] max-w-[260px] shrink-0 flex flex-col border-r border-[var(--border-color)] bg-[var(--bg-secondary)]/60"
          aria-label="Tim message queue"
        >
          <div className="shrink-0 px-2 py-1.5 border-b border-[var(--border-color)]/80 space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              Messages ({queue.length})
            </span>
            {warmOutreachDaily && warmOutreachDaily.target > 0 ? (
              <div className="rounded border border-[var(--border-color)]/60 bg-[var(--bg-primary)]/40 px-1.5 py-1">
                <p className="text-[9px] font-medium text-[var(--text-primary)] leading-tight">
                  Today (PT): {warmOutreachDaily.completed} / {warmOutreachDaily.target} contact intakes
                </p>
                <p className="text-[8px] text-[var(--text-tertiary)] leading-snug mt-0.5">
                  Target sums <code className="text-[8px]">discoveriesPerDay</code> on each active warm-outreach
                  package. Submit notes on a discovery slot to count.
                </p>
                {warmOutreachDaily.completed < warmOutreachDaily.target ? (
                  <p className="text-[8px] text-amber-600/90 dark:text-amber-400/90 mt-0.5 leading-snug">
                    {warmOutreachDaily.target - warmOutreachDaily.completed} left to hit today’s goal.
                  </p>
                ) : (
                  <p className="text-[8px] text-[var(--accent-green)]/90 mt-0.5">Daily intake goal met.</p>
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
          <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
            {queue.length === 0 ? (
              <p className="text-[10px] text-[var(--text-tertiary)] text-center py-6 px-1">Queue empty</p>
            ) : (
              queue.map((task) => {
                const active = task.itemId === selectedId;
                const secondary = timQueueCardSecondaryLine(task);
                return (
                  <button
                    key={task.itemId}
                    type="button"
                    onClick={() => setSelectedId(task.itemId)}
                    className={`w-full text-left rounded-md px-2 py-1.5 border transition-colors ${
                      active
                        ? "border-[var(--accent-green)]/50 bg-[var(--accent-green)]/10"
                        : "border-transparent bg-[var(--bg-primary)]/80 hover:border-[var(--border-color)]"
                    }`}
                  >
                    <div className="text-[10px] font-semibold text-[var(--text-primary)] truncate">
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
              })
            )}
          </div>
        </aside>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col p-2">
          {selected ? (
            <>
              {selected.contactDbSyncPending ? (
                <div className="shrink-0 mb-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2">
                  <p className="text-[11px] text-[var(--text-primary)] leading-snug">
                    The CRM <strong>person</strong> for this slot is still the placeholder (Next / Contact). Your
                    notes exist on the workflow but were never written to the contact record.
                  </p>
                  {warmSyncHint ? (
                    <p className="text-[10px] text-amber-200/90 mt-1.5 leading-snug">{warmSyncHint}</p>
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
                        await fetchTasks();
                      } finally {
                        setSyncingWarmContact(false);
                      }
                    }}
                    className="mt-2 text-[10px] px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-200 font-semibold border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50"
                  >
                    {syncingWarmContact ? "Saving…" : "Save contact to CRM from intake notes"}
                  </button>
                </div>
              ) : null}
              {isInputStage ? (
                <TimIntakeWorkspace
                  task={selected}
                  resolving={resolving === selected.itemId}
                  documentHeaderDetail={warmPersonHeaderDetail}
                  onSubmitInput={async (notes) => {
                    await handleResolve(selected.itemId, "input", notes);
                  }}
                />
              ) : (
                <>
                {selected.waitingFollowUp ? (
                  <div className="shrink-0 mb-2 rounded-lg border border-teal-500/20 bg-teal-500/5 px-3 py-2">
                    <p className="text-[11px] font-semibold text-[var(--text-primary)]">
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
                      className="mt-2 text-[10px] px-2.5 py-1 rounded-md bg-[var(--accent-green)]/20 text-[var(--accent-green)] font-semibold border border-[var(--accent-green)]/40 hover:bg-[var(--accent-green)]/30 disabled:opacity-50"
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
                    pollArtifactsMs={5000}
                    workflowItemId={selected.itemId}
                    itemType={selected.itemType === "person" ? "person" : "content"}
                    title={selected.workflowName}
                    headerDetail={warmPersonHeaderDetail}
                    agentId={selected.ownerAgent || "tim"}
                    onSubmitTask={
                      timShowsArtifactSubmit(selected)
                        ? async () => {
                            await handleResolve(selected.itemId, "approve");
                          }
                        : undefined
                    }
                    confirmedWorkflowActions={timWarmHeaderActions}
                    onActiveArtifactChange={setFocusedArtifact}
                    onClose={() => setSelectedId(null)}
                  />
                </div>
                {timSecondaryActionsVisible(selected) ? (
                  <TimTaskActionBar task={selected} resolving={resolving} onResolve={handleResolve} />
                ) : null}
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
