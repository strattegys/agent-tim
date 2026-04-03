"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import useSWR from "swr";
import { panelBus } from "@/lib/events";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type { MarniWorkQueueSelection } from "@/lib/marni-work-context";
import ArtifactViewer from "@/components/shared/ArtifactViewer";
import LinkedInPostPreviewCard, {
  splitPostAndFirstComment,
} from "@/components/marni/LinkedInPostPreviewCard";

const MARNI_NO_REJECT_STAGES = new Set(["RECEIVED", "POSTED"]);

interface DistributionTask {
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
  updatedAt?: string;
  humanTaskOpen: boolean;
}

function affiliationLine(t: DistributionTask): string {
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

const POLL_MS_VISIBLE = 10_000;
const POLL_MS_HIDDEN = 45_000;
const MARNI_QUEUE_SWR_KEY = "marni-distribution-queue";

type MarniBucketTab = "needs_review" | "scheduled" | "all";

function isScheduledPostRow(task: DistributionTask): boolean {
  const st = (task.stage || "").trim().toUpperCase();
  if (st !== "POSTED") return false;
  const d = task.dueDate?.trim();
  if (!d) return false;
  const ms = new Date(d).getTime();
  return Number.isFinite(ms) && ms > Date.now();
}

function marniTaskBucket(task: DistributionTask): MarniBucketTab {
  if (isScheduledPostRow(task)) return "scheduled";
  if (task.humanTaskOpen) return "needs_review";
  return "all";
}

function taskMatchesBucket(task: DistributionTask, tab: MarniBucketTab): boolean {
  if (tab === "all") return true;
  if (tab === "scheduled") return isScheduledPostRow(task);
  return task.humanTaskOpen && !isScheduledPostRow(task);
}

async function fetchMarniTasksPage(): Promise<DistributionTask[]> {
  const qs = new URLSearchParams({
    ownerAgent: "marni",
    distributionOnly: "1",
    limit: "80",
    offset: "0",
  });
  const r = await fetch(`/api/crm/human-tasks?${qs}`, { credentials: "include" });
  if (!r.ok) throw new Error(`Could not load queue (HTTP ${r.status}).`);
  const data = await r.json();
  const list = Array.isArray(data.tasks) ? data.tasks : [];
  return list.map((t: Record<string, unknown>): DistributionTask => ({
    itemId: String(t.itemId),
    itemTitle: String(t.itemTitle || ""),
    itemSubtitle: String(t.itemSubtitle || ""),
    sourceId: t.sourceId != null ? String(t.sourceId) : null,
    workflowId: String(t.workflowId || ""),
    workflowName: String(t.workflowName || ""),
    packageName: String(t.packageName || ""),
    ownerAgent: String(t.ownerAgent || "marni"),
    packageId: t.packageId != null ? String(t.packageId) : null,
    packageNumber: t.packageNumber != null ? Number(t.packageNumber) : null,
    packageStage: t.packageStage != null ? String(t.packageStage) : null,
    inActiveCampaign: Boolean(t.inActiveCampaign),
    workflowType: String(t.workflowType || ""),
    stage: String(t.stage || ""),
    stageLabel: String(t.stageLabel || ""),
    humanAction: String(t.humanAction || ""),
    dueDate: t.dueDate != null ? String(t.dueDate) : null,
    itemType: String(t.itemType || "content"),
    createdAt: String(t.createdAt || ""),
    updatedAt:
      t.updatedAt != null && String(t.updatedAt).trim() !== ""
        ? String(t.updatedAt)
        : String(t.createdAt || ""),
    humanTaskOpen: typeof t.humanTaskOpen === "boolean" ? t.humanTaskOpen : true,
  }));
}

function MarniQueueItemRow({
  task,
  active,
  onSelect,
}: {
  task: DistributionTask;
  active: boolean;
  onSelect: () => void;
}) {
  const secondary = task.stageLabel?.trim() || task.stage.replace(/_/g, " ");
  const scheduled = isScheduledPostRow(task);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`w-full text-left rounded-lg px-3 py-2.5 border transition-colors ${
        active
          ? "border-[var(--accent-green)]/80 bg-[var(--accent-green)]/14 shadow-sm ring-2 ring-inset ring-[var(--accent-green)]/45"
          : "border-[var(--border-color)] bg-[var(--bg-primary)]/90 hover:border-[var(--text-tertiary)]/55"
      }`}
    >
      <div
        className={`text-[11px] leading-snug break-words ${active ? "font-semibold text-[var(--text-primary)]" : "font-semibold text-[var(--text-chat-body)]"}`}
      >
        {task.itemTitle}
      </div>
      <div className="text-[10px] text-[var(--text-tertiary)] mt-1 leading-snug">{secondary}</div>
      {scheduled && task.dueDate ? (
        <div className="text-[9px] text-[var(--text-secondary)] mt-1 tabular-nums">
          Due {new Date(task.dueDate).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </div>
      ) : null}
      <div className="text-[9px] text-[var(--text-secondary)] mt-1 leading-tight break-words">
        {affiliationLine(task)}
      </div>
    </button>
  );
}

function marniShowsArtifactSubmit(task: DistributionTask): boolean {
  const s = task.stage?.toUpperCase() || "";
  return s === "CONN_MSG_DRAFTED" || s === "POST_DRAFTED";
}

function MarniTaskActionBar({
  task,
  resolving,
  onResolve,
}: {
  task: DistributionTask;
  resolving: string | null;
  onResolve: (itemId: string, action: "approve" | "reject" | "input") => void;
}) {
  const showReject = !MARNI_NO_REJECT_STAGES.has(task.stage);
  return (
    <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-t border-[var(--border-color)] bg-[var(--bg-secondary)]">
      <span className="text-[10px] text-[var(--text-tertiary)] mr-auto hidden sm:inline max-w-[min(100%,28rem)] leading-snug">
        {task.humanAction}
      </span>
      {showReject ? (
        <button
          type="button"
          onClick={() => onResolve(task.itemId, "reject")}
          disabled={resolving === task.itemId}
          className="text-[10px] px-2.5 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-50"
        >
          Reject
        </button>
      ) : null}
    </div>
  );
}

export default function MarniMessagesPanel({
  embedded = false,
  onWorkSelectionChange,
}: {
  embedded?: boolean;
  onWorkSelectionChange?: (selection: MarniWorkQueueSelection | null) => void;
}) {
  const [resolving, setResolving] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolveHint, setResolveHint] = useState<string | null>(null);
  const [focusedArtifact, setFocusedArtifact] = useState<{ stage: string; label: string } | null>(null);
  const [bucketTab, setBucketTab] = useState<MarniBucketTab>("needs_review");
  const [postDraftArtifact, setPostDraftArtifact] = useState<string>("");
  const tabVisible = useDocumentVisible();

  const { data: tasks = [], error: swrError, isLoading: loading, mutate: refreshTasks } = useSWR<DistributionTask[]>(
    MARNI_QUEUE_SWR_KEY,
    fetchMarniTasksPage,
    {
      refreshInterval: tabVisible ? POLL_MS_VISIBLE : POLL_MS_HIDDEN,
      revalidateOnFocus: true,
      dedupingInterval: 5_000,
    }
  );

  const loadError = swrError
    ? swrError instanceof Error
      ? swrError.message
      : "Network error loading queue."
    : null;

  useEffect(() => {
    const u1 = panelBus.on("workflow_items", () => void refreshTasks());
    const u2 = panelBus.on("package_manager", () => void refreshTasks());
    const u3 = panelBus.on("marni_human_task_progress", () => void refreshTasks());
    return () => {
      u1();
      u2();
      u3();
    };
  }, [refreshTasks]);

  const sortedTasks = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        const tb = String(b.updatedAt || b.createdAt || "");
        const ta = String(a.updatedAt || a.createdAt || "");
        return tb.localeCompare(ta);
      }),
    [tasks]
  );

  const filteredByBucket = useMemo(
    () => sortedTasks.filter((t) => taskMatchesBucket(t, bucketTab)),
    [sortedTasks, bucketTab]
  );

  const bucketCounts = useMemo(() => {
    let needs_review = 0;
    let scheduled = 0;
    for (const t of sortedTasks) {
      if (isScheduledPostRow(t)) scheduled += 1;
      else if (t.humanTaskOpen) needs_review += 1;
    }
    return { needs_review, scheduled, all: sortedTasks.length };
  }, [sortedTasks]);

  useEffect(() => {
    if (sortedTasks.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => {
      const inFiltered = prev && filteredByBucket.some((t) => t.itemId === prev);
      if (inFiltered) return prev;
      return filteredByBucket[0]?.itemId ?? null;
    });
  }, [sortedTasks, filteredByBucket]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return sortedTasks.find((t) => t.itemId === selectedId) ?? null;
  }, [sortedTasks, selectedId]);

  useEffect(() => {
    setFocusedArtifact(null);
  }, [selectedId]);

  useEffect(() => {
    setResolveHint(null);
  }, [selectedId]);

  useEffect(() => {
    if (!selected?.itemId) {
      setPostDraftArtifact("");
      return;
    }
    let cancelled = false;
    const loadPostDraft = () => {
      fetch(`/api/crm/artifacts?workflowItemId=${encodeURIComponent(selected.itemId)}`, {
        credentials: "include",
      })
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          const arts = Array.isArray(data.artifacts) ? data.artifacts : [];
          const post = arts
            .filter((a: { stage?: string; deletedAt?: unknown }) => !a.deletedAt)
            .filter((a: { stage?: string }) => String(a.stage || "").toUpperCase() === "POST_DRAFTED")
            .sort(
              (a: { createdAt?: string }, b: { createdAt?: string }) =>
                String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
            );
          const last = post[post.length - 1] as { content?: string } | undefined;
          setPostDraftArtifact(typeof last?.content === "string" ? last.content : "");
        })
        .catch(() => {
          if (!cancelled) setPostDraftArtifact("");
        });
    };
    loadPostDraft();
    const t = setInterval(loadPostDraft, 12_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [selected?.itemId]);

  const { post: parsedPost, firstComment: parsedFirst } = useMemo(
    () => splitPostAndFirstComment(postDraftArtifact),
    [postDraftArtifact]
  );

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
      workflowType: selected.workflowType,
      humanAction: selected.humanAction,
      humanTaskOpen: selected.humanTaskOpen,
      scheduledSlot: isScheduledPostRow(selected),
      focusedArtifactStage: focusedArtifact?.stage ?? null,
      focusedArtifactLabel: focusedArtifact?.label ?? null,
    });
  }, [selected, focusedArtifact, onWorkSelectionChange]);

  useEffect(() => {
    return () => {
      onWorkSelectionChange?.(null);
    };
  }, [onWorkSelectionChange]);

  const handleResolve = useCallback(
    async (itemId: string, action: "approve" | "reject" | "input", notes?: string) => {
      if (resolving) return;
      setResolving(itemId);
      try {
        const res = await fetch("/api/crm/human-tasks/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, action, notes: notes || undefined }),
        });
        const data = await res.json();
        if (data.ok) {
          setResolveHint(null);
          panelBus.emit("marni_human_task_progress");
          panelBus.emit("dashboard_sync");
          await new Promise((r) => setTimeout(r, 350));
          await refreshTasks();
        } else {
          setResolveHint(
            typeof (data as { error?: string }).error === "string"
              ? (data as { error: string }).error
              : `HTTP ${res.status}`
          );
        }
      } catch {
        /* ignore */
      }
      setResolving(null);
    },
    [refreshTasks, resolving]
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-[var(--text-tertiary)]">Loading distribution queue…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {!embedded && (
        <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <span className="text-xs font-medium text-[var(--text-chat-body)]">Marni — distribution work queue</span>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 leading-snug">
            LinkedIn drafts and connection templates. <strong className="text-[var(--text-secondary)]">Scheduled</strong>{" "}
            uses POSTED rows with a future due date.
          </p>
          {loadError && <p className="text-[10px] text-[var(--text-secondary)] mt-1">{loadError}</p>}
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
          aria-label="Marni distribution queue"
        >
          <div className="shrink-0 px-2.5 py-2 border-b border-[var(--border-color)]/80 space-y-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              List · {filteredByBucket.length}
              {bucketTab !== "all" ? ` / ${sortedTasks.length} total` : ""}
            </span>
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Queue buckets">
              {(
                [
                  ["needs_review", "Needs review", bucketCounts.needs_review],
                  ["scheduled", "Scheduled", bucketCounts.scheduled],
                  ["all", "All", bucketCounts.all],
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
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
            {sortedTasks.length === 0 ? (
              <p className="text-[10px] text-[var(--text-tertiary)] text-center py-6 px-1">
                No distribution items. When Ghost publishes, a sibling content-distribution workflow should appear here.
              </p>
            ) : filteredByBucket.length === 0 ? (
              <p className="text-[10px] text-[var(--text-tertiary)] text-center py-6 px-1">
                Nothing in this bucket. Try <strong>All</strong> or another tab.
              </p>
            ) : (
              filteredByBucket.map((task) => (
                <MarniQueueItemRow
                  key={task.itemId}
                  task={task}
                  active={task.itemId === selectedId}
                  onSelect={() => setSelectedId(task.itemId)}
                />
              ))
            )}
          </div>
        </aside>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col p-2 gap-2">
          {selected ? (
            <>
              {resolveHint ? (
                <div className="shrink-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2">
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
              <div className="shrink-0 max-h-[min(52vh,420px)] overflow-y-auto">
                <LinkedInPostPreviewCard
                  postMarkdown={parsedPost}
                  firstCommentMarkdown={parsedFirst}
                  authorLabel="You"
                />
              </div>
              <div className="flex-1 min-h-0 min-w-0 flex flex-col border border-[var(--border-color)] rounded-lg overflow-hidden bg-[var(--bg-primary)]/30">
                <ArtifactViewer
                  key={`${selected.itemId}-${selected.stage}`}
                  variant="inline"
                  alwaysShowArtifactTabs
                  allWorkflowArtifacts
                  showArtifactChat={false}
                  showArtifactFooter={false}
                  pollArtifactsMs={30_000}
                  workflowItemId={selected.itemId}
                  itemType="content"
                  title={selected.workflowName}
                  agentId="marni"
                  onSubmitTask={
                    marniShowsArtifactSubmit(selected)
                      ? async () => {
                          await handleResolve(selected.itemId, "approve");
                        }
                      : undefined
                  }
                  onActiveArtifactChange={setFocusedArtifact}
                  onClose={() => setSelectedId(null)}
                />
              </div>
              <MarniTaskActionBar task={selected} resolving={resolving} onResolve={handleResolve} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6">
              <p className="text-sm text-[var(--text-tertiary)] text-center">
                Select a distribution item to preview the LinkedIn post and edit artifacts.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
