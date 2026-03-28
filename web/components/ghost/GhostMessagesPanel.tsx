"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { panelBus } from "@/lib/events";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type { GhostWorkQueueSelection } from "@/lib/ghost-work-context";
import ArtifactViewer from "../shared/ArtifactViewer";
import TimIntakeWorkspace from "../tim/TimIntakeWorkspace";

/** Form-first step for content pipeline */
const INPUT_ONLY_STAGES = new Set(["IDEA"]);

const GHOST_NO_REJECT_STAGES = new Set(["IDEA", "DRAFTING", "PUBLISHED"]);

interface ContentWorkTask {
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
}

function messageAffiliationLine(t: ContentWorkTask): string {
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

const POLL_MS_VISIBLE = 8000;
const POLL_MS_HIDDEN = 30_000;

function contentTasksFingerprint(
  list: Array<{
    itemId: string;
    stage: string;
    itemTitle: string;
    stageLabel: string;
    humanAction: string;
    workflowId: string;
    dueDate: string | null;
  }>
): string {
  return list
    .map(
      (t) =>
        `${t.itemId}\t${t.stage}\t${t.itemTitle}\t${t.stageLabel}\t${t.humanAction}\t${t.workflowId}\t${t.dueDate ?? ""}`
    )
    .join("\n");
}

function GhostQueueItemRow({
  task,
  active,
  onSelect,
}: {
  task: ContentWorkTask;
  active: boolean;
  onSelect: () => void;
}) {
  const secondary = task.stageLabel?.trim() || task.stage.replace(/_/g, " ");
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
      <div className="text-[10px] font-medium text-[var(--text-chat-body)] truncate">{task.itemTitle}</div>
      <div className="text-[9px] text-[var(--text-tertiary)] truncate">{secondary}</div>
      <div className="text-[9px] text-[var(--text-secondary)] truncate mt-0.5 leading-tight">
        {messageAffiliationLine(task)}
      </div>
    </button>
  );
}

function GhostTaskActionBar({
  task,
  resolving,
  onResolve,
}: {
  task: ContentWorkTask;
  resolving: string | null;
  onResolve: (itemId: string, action: "approve" | "reject" | "input") => void;
}) {
  const showReject = !GHOST_NO_REJECT_STAGES.has(task.stage);
  return (
    <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-t border-[var(--border-color)] bg-[var(--bg-secondary)]">
      <span className="text-[10px] text-[var(--text-tertiary)] mr-auto hidden sm:inline">
        {task.humanAction}
      </span>
      {showReject ? (
        <div className="flex flex-wrap gap-1.5 justify-end w-full sm:w-auto">
          <button
            type="button"
            onClick={() => onResolve(task.itemId, "reject")}
            disabled={resolving === task.itemId}
            className="text-[10px] px-2.5 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ghostShowsArtifactSubmit(task: ContentWorkTask): boolean {
  const s = task.stage?.toUpperCase() || "";
  return s === "CAMPAIGN_SPEC" || s === "REVIEW" || s === "DRAFT_PUBLISHED";
}

export default function GhostMessagesPanel({
  embedded = false,
  onWorkSelectionChange,
}: {
  embedded?: boolean;
  onWorkSelectionChange?: (selection: GhostWorkQueueSelection | null) => void;
}) {
  const [tasks, setTasks] = useState<ContentWorkTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolveHint, setResolveHint] = useState<string | null>(null);
  const [contentTitleDraft, setContentTitleDraft] = useState("");
  const [savingContentTitle, setSavingContentTitle] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [focusedArtifact, setFocusedArtifact] = useState<{ stage: string; label: string } | null>(null);
  const mountedRef = useRef(true);
  const lastTasksFingerprintRef = useRef<string>("");
  const tabVisible = useDocumentVisible();

  const fetchTasks = useCallback((): Promise<void> => {
    return fetch(
      "/api/crm/human-tasks?ownerAgent=ghost&sourceType=content&excludePackageStages=DRAFT,PENDING_APPROVAL",
      { credentials: "include" }
    )
      .then(async (r) => {
        if (!r.ok) {
          const snippet = (await r.text()).slice(0, 120);
          console.warn("[GhostMessagesPanel] human-tasks", r.status, snippet);
          if (mountedRef.current) {
            setLoadError(`Could not load queue (HTTP ${r.status}).`);
            lastTasksFingerprintRef.current = "";
            setTasks([]);
          }
          return null;
        }
        if (mountedRef.current) setLoadError(null);
        return r.json();
      })
      .then((data) => {
        if (data == null) return;
        if (data.error) console.warn("[GhostMessagesPanel] human-tasks API:", data.error);
        const list = Array.isArray(data.tasks) ? data.tasks : [];
        if (mountedRef.current) {
          const next = list
            .filter((t: Record<string, unknown>) => String(t.itemType || "").toLowerCase() === "content")
            .map((t: Record<string, unknown>) => ({
              itemId: String(t.itemId),
              itemTitle: String(t.itemTitle || ""),
              itemSubtitle: String(t.itemSubtitle || ""),
              sourceId: t.sourceId != null ? String(t.sourceId) : null,
              workflowId: String(t.workflowId || ""),
              workflowName: String(t.workflowName || ""),
              packageName: String(t.packageName || ""),
              ownerAgent: String(t.ownerAgent || "ghost"),
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
            }));
          const fp = contentTasksFingerprint(next);
          if (fp !== lastTasksFingerprintRef.current) {
            lastTasksFingerprintRef.current = fp;
            setTasks(next);
          }
        }
      })
      .catch((e) => {
        console.warn("[GhostMessagesPanel] human-tasks fetch failed:", e);
        if (mountedRef.current) {
          setLoadError("Network error loading queue.");
          lastTasksFingerprintRef.current = "";
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
    const ms = tabVisible ? POLL_MS_VISIBLE : POLL_MS_HIDDEN;
    const interval = setInterval(fetchTasks, ms);
    const u1 = panelBus.on("workflow_items", fetchTasks);
    const u2 = panelBus.on("package_manager", fetchTasks);
    const u3 = panelBus.on("ghost_human_task_progress", fetchTasks);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      u1();
      u2();
      u3();
    };
  }, [fetchTasks, tabVisible]);

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [tasks]
  );

  useEffect(() => {
    if (sortedTasks.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) =>
      prev && sortedTasks.some((t) => t.itemId === prev) ? prev : sortedTasks[0]?.itemId ?? null
    );
  }, [sortedTasks]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return sortedTasks.find((t) => t.itemId === selectedId) ?? null;
  }, [sortedTasks, selectedId]);

  const isInputStage = Boolean(selected && INPUT_ONLY_STAGES.has(selected.stage));

  useEffect(() => {
    setFocusedArtifact(null);
  }, [selectedId]);

  useEffect(() => {
    setResolveHint(null);
  }, [selectedId]);

  useEffect(() => {
    if (selected?.sourceId) {
      setContentTitleDraft(selected.itemTitle);
    } else {
      setContentTitleDraft("");
    }
  }, [selectedId, selected?.itemTitle, selected?.sourceId]);

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
          panelBus.emit("ghost_human_task_progress");
          panelBus.emit("dashboard_sync");
          await new Promise((r) => setTimeout(r, 350));
          await fetchTasks();
        } else {
          const errText =
            typeof (data as { error?: string }).error === "string"
              ? (data as { error: string }).error
              : `HTTP ${res.status}`;
          setResolveHint(errText);
          pushLogs([
            `[${new Date().toISOString()}] Resolve failed: ${(data as { error?: string }).error || res.status}`,
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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-[var(--text-tertiary)]">Loading content queue…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {!embedded && (
        <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <span className="text-xs font-medium text-[var(--text-chat-body)]">Ghost — content work queue</span>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 leading-snug">
            Content workflow items only. Use the work shortcut under Ghost’s header for the same layout in Command Central.
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
          aria-label="Ghost content work queue"
        >
          <div className="shrink-0 px-2 py-1.5 border-b border-[var(--border-color)]/80">
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              Content queue · {sortedTasks.length}
            </span>
            <p className="text-[8px] text-[var(--text-tertiary)] leading-snug mt-0.5">
              Active / approved packages only — Draft and Testing (planner) are excluded.
            </p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
            {sortedTasks.length === 0 ? (
              <p className="text-[10px] text-[var(--text-tertiary)] text-center py-6 px-1">No content tasks</p>
            ) : (
              sortedTasks.map((task) => (
                <GhostQueueItemRow
                  key={task.itemId}
                  task={task}
                  active={task.itemId === selectedId}
                  onSelect={() => setSelectedId(task.itemId)}
                />
              ))
            )}
          </div>
        </aside>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col p-2">
          {selected ? (
            <>
              {selected.sourceId ? (
                <div className="shrink-0 mb-2 flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/50 px-2.5 py-2">
                  <label className="flex-1 min-w-[160px] flex flex-col gap-0.5">
                    <span className="text-[9px] font-semibold text-[var(--text-tertiary)]">
                      Content title
                    </span>
                    <input
                      value={contentTitleDraft}
                      onChange={(e) => setContentTitleDraft(e.target.value)}
                      className="text-[11px] w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1 text-[var(--text-primary)]"
                      placeholder="Working title for this piece"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={
                      savingContentTitle ||
                      !contentTitleDraft.trim() ||
                      contentTitleDraft.trim() === selected.itemTitle.trim()
                    }
                    onClick={async () => {
                      if (!selected.sourceId) return;
                      setSavingContentTitle(true);
                      try {
                        const r = await fetch("/api/crm/content-item", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({
                            id: selected.sourceId,
                            title: contentTitleDraft.trim(),
                          }),
                        });
                        const data = (await r.json().catch(() => ({}))) as { error?: string };
                        if (!r.ok) {
                          setResolveHint(data.error || `Could not save title (${r.status})`);
                          return;
                        }
                        setResolveHint(null);
                        panelBus.emit("workflow_items");
                        await fetchTasks();
                      } finally {
                        setSavingContentTitle(false);
                      }
                    }}
                    className="text-[10px] px-2.5 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)]/40 disabled:opacity-40"
                  >
                    {savingContentTitle ? "Saving…" : "Save title"}
                  </button>
                </div>
              ) : null}
              {["CAMPAIGN_SPEC", "DRAFTING", "REVIEW", "DRAFT_PUBLISHED"].includes(
                selected.stage.toUpperCase()
              ) && selected.workflowType === "content-pipeline" ? (
                <div className="shrink-0 mb-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2">
                  <p className="text-[10px] text-[var(--text-chat-body)] leading-snug">
                    Return to <strong className="text-[var(--text-primary)]">IDEA</strong> using the idea you already
                    submitted. This removes campaign spec, drafting, and review artifacts for this item only — your
                    original <strong className="text-[var(--text-primary)]">IDEA</strong> note stays so you can submit
                    again and have Ghost regenerate the spec (and later the draft).
                  </p>
                  <button
                    type="button"
                    disabled={rollbackLoading}
                    onClick={async () => {
                      if (
                        !confirm(
                          "Move this item back to IDEA? Spec, draft, and review artifacts will be removed. Your original idea text is kept — use Submit on the Idea step to continue."
                        )
                      ) {
                        return;
                      }
                      setRollbackLoading(true);
                      setResolveHint(null);
                      try {
                        const r = await fetch("/api/crm/workflow-items/rollback-to-idea", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({ itemId: selected.itemId }),
                        });
                        const data = (await r.json().catch(() => ({}))) as { error?: string };
                        if (!r.ok) {
                          setResolveHint(data.error || `Rollback failed (${r.status})`);
                          return;
                        }
                        panelBus.emit("ghost_human_task_progress");
                        panelBus.emit("workflow_items");
                        await fetchTasks();
                      } finally {
                        setRollbackLoading(false);
                      }
                    }}
                    className="mt-2 text-[10px] px-2.5 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)]/40 disabled:opacity-50"
                  >
                    {rollbackLoading ? "Working…" : "Go back to idea (keep my original idea)"}
                  </button>
                </div>
              ) : null}
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
              {isInputStage ? (
                <TimIntakeWorkspace
                  task={selected}
                  resolving={resolving === selected.itemId}
                  chatAgentLabel="Ghost"
                  onSubmitInput={async (notes) => {
                    await handleResolve(selected.itemId, "input", notes);
                  }}
                />
              ) : (
                <>
                  <div className="flex-1 min-h-0 min-w-0">
                    <ArtifactViewer
                      key={`${selected.itemId}-${selected.stage}`}
                      variant="inline"
                      alwaysShowArtifactTabs
                      allWorkflowArtifacts
                      showArtifactChat={false}
                      showArtifactFooter={false}
                      pollArtifactsMs={30000}
                      workflowItemId={selected.itemId}
                      itemType="content"
                      title={selected.workflowName}
                      agentId="ghost"
                      onSubmitTask={
                        ghostShowsArtifactSubmit(selected)
                          ? async () => {
                              await handleResolve(selected.itemId, "approve");
                            }
                          : undefined
                      }
                      onActiveArtifactChange={setFocusedArtifact}
                      onClose={() => setSelectedId(null)}
                    />
                  </div>
                  <GhostTaskActionBar task={selected} resolving={resolving} onResolve={handleResolve} />
                </>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6">
              <p className="text-sm text-[var(--text-tertiary)] text-center">
                Select a content item to open the workspace.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
