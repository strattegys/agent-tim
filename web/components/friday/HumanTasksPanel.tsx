"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { panelBus } from "@/lib/events";
import ArtifactViewer from "../shared/ArtifactViewer";

const AGENT_COLORS: Record<string, string> = {
  scout: "#2563EB",
  tim: "#1D9E75",
  ghost: "#4A90D9",
  marni: "#D4A017",
  penny: "#E67E22",
  friday: "#9B59B6",
};

/** Human-readable action labels for each stage that requires human input */
const STAGE_ACTION_LABELS: Record<string, string> = {
  IDEA: "Review Content Brief",
  REVIEW: "Review Article Draft",
  DRAFT_PUBLISHED: "Review Publication Details",
  QUALIFICATION: "Review Qualified Target",
  POST_DRAFTED: "Review LinkedIn Post",
  INITIATED: "Review Connection Request",
  MESSAGED: "Review Outreach Message",
};

interface HumanTask {
  itemId: string;
  itemTitle: string;
  itemSubtitle: string;
  workflowId: string;
  workflowName: string;
  packageName: string;
  ownerAgent: string;
  packageId: string | null;
  stage: string;
  stageLabel: string;
  humanAction: string;
  dueDate: string | null;
  itemType: string;
  createdAt: string;
}

interface HumanTasksPanelProps {
  onSwitchToAgent?: (agentId: string) => void;
  /** Filter to only show tasks from packages at this stage. Default: no filter (all tasks). */
  packageStageFilter?: string;
}

const POLL_INTERVAL = 5000;

export default function HumanTasksPanel({ onSwitchToAgent, packageStageFilter }: HumanTasksPanelProps) {
  const [tasks, setTasks] = useState<HumanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [artifactView, setArtifactView] = useState<{ workflowItemId: string; focusStage?: string } | null>(null);
  const [inputTask, setInputTask] = useState<string | null>(null);
  const [inputNotes, setInputNotes] = useState("");
  const [tab, setTab] = useState<"now" | "later">("now");
  const mountedRef = useRef(true);

  // Split tasks into now (no due date or due today/past) and later (future due date)
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const nowTasks = tasks.filter(t => !t.dueDate || new Date(t.dueDate) <= today);
  const laterTasks = tasks.filter(t => t.dueDate && new Date(t.dueDate) > today);
  const visibleTasks = tab === "now" ? nowTasks : laterTasks;

  const fetchTasks = useCallback(() => {
    fetch(`/api/crm/human-tasks${packageStageFilter ? `?packageStage=${packageStageFilter}` : ""}`)
      .then((r) => r.json())
      .then((data) => {
        if (mountedRef.current) setTasks(data.tasks || []);
      })
      .catch(() => {
        if (mountedRef.current) setTasks([]);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchTasks();
    const interval = setInterval(fetchTasks, POLL_INTERVAL);
    const unsub1 = panelBus.on("workflow_items", fetchTasks);
    const unsub2 = panelBus.on("workflow_manager", fetchTasks);
    const unsub3 = panelBus.on("package_manager", fetchTasks);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      unsub1();
      unsub2();
      unsub3();
    };
  }, [fetchTasks]);

  const handleResolve = useCallback(
    async (itemId: string, action: "approve" | "reject", notes?: string) => {
      setResolving(itemId);
      try {
        const res = await fetch("/api/crm/human-tasks/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, action, notes: notes || undefined }),
        });
        const data = await res.json();
        if (data.ok) {
          // Remove the task from the list immediately
          setTasks((prev) => prev.filter((t) => t.itemId !== itemId));
          setInputTask(null);
          setInputNotes("");
          // Re-fetch to get accurate state
          setTimeout(fetchTasks, 500);
        }
      } catch {
        // ignore
      }
      setResolving(null);
    },
    [fetchTasks]
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-[var(--text-tertiary)]">Loading tasks...</p>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-[var(--text-tertiary)]">No pending tasks</p>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
            Tasks appear here when a workflow item needs your input
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Now / Later tabs */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 shrink-0">
        <button
          onClick={() => setTab("now")}
          className={`text-[11px] px-3 py-1 rounded-full font-semibold transition-colors ${
            tab === "now"
              ? "bg-amber-500/20 text-amber-400"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          }`}
        >
          Now{nowTasks.length > 0 ? ` (${nowTasks.length})` : ""}
        </button>
        <button
          onClick={() => setTab("later")}
          className={`text-[11px] px-3 py-1 rounded-full font-semibold transition-colors ${
            tab === "later"
              ? "bg-blue-500/20 text-blue-400"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          }`}
        >
          Later{laterTasks.length > 0 ? ` (${laterTasks.length})` : ""}
        </button>
      </div>

      {visibleTasks.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[11px] text-[var(--text-tertiary)]">
            {tab === "now" ? "No tasks due now" : "No scheduled tasks"}
          </p>
        </div>
      )}

      {visibleTasks.length > 0 && (
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
          {visibleTasks.map((task) => (
              <div
                key={task.itemId}
                className="rounded-lg p-3 border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:border-amber-500/40 transition-colors"
              >
                {/* Task title: Package — Action Label */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                    {task.packageName ? `${task.packageName} — ` : ""}{STAGE_ACTION_LABELS[task.stage] || task.stageLabel}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <img
                      src={`/api/agent-avatar?id=${task.ownerAgent}`}
                      alt={task.ownerAgent}
                      className="w-4 h-4 rounded-full object-cover"
                      style={{ border: `1.5px solid ${AGENT_COLORS[task.ownerAgent] || "#888"}` }}
                    />
                    <span className="text-[10px] text-[var(--text-tertiary)] capitalize">{task.ownerAgent}</span>
                  </span>
                  {task.dueDate && (
                    <span className={`text-[9px] ml-auto shrink-0 ${
                      new Date(task.dueDate) <= new Date() ? "text-amber-400" : "text-blue-400"
                    }`}>
                      {new Date(task.dueDate) <= new Date()
                        ? "Due now"
                        : `Due ${new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                      }
                    </span>
                  )}
                </div>

                {/* Human action */}
                <div className="flex items-start gap-1.5 mb-3">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="shrink-0 mt-0.5"
                  >
                    <circle cx="12" cy="7" r="4" />
                    <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
                  </svg>
                  <span className="text-[11px] text-amber-300/80 leading-relaxed">
                    {task.humanAction}
                  </span>
                </div>

                {/* Input area (shown when user clicks "Add Notes") */}
                {inputTask === task.itemId && (
                  <div className="mb-3">
                    <textarea
                      value={inputNotes}
                      onChange={(e) => setInputNotes(e.target.value)}
                      placeholder="Add notes, feedback, or a URL..."
                      className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-2 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] resize-none focus:outline-none focus:border-amber-500/50"
                      rows={3}
                    />
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setArtifactView({ workflowItemId: task.itemId, focusStage: undefined })}
                    className="text-[10px] px-2.5 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)] transition-colors"
                  >
                    View Artifacts
                  </button>

                  {inputTask !== task.itemId ? (
                    <button
                      onClick={() => {
                        setInputTask(task.itemId);
                        setInputNotes("");
                      }}
                      className="text-[10px] px-2.5 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)] transition-colors"
                    >
                      Add Notes
                    </button>
                  ) : (
                    <button
                      onClick={() => setInputTask(null)}
                      className="text-[10px] px-2.5 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                    >
                      Cancel
                    </button>
                  )}

                  <div className="flex items-center gap-1.5 ml-auto">
                    <button
                      onClick={() => handleResolve(task.itemId, "reject", inputTask === task.itemId ? inputNotes : undefined)}
                      disabled={resolving === task.itemId}
                      className="text-[10px] px-3 py-1 rounded bg-red-900/30 border border-red-800/50 text-red-400 hover:bg-red-900/50 transition-colors disabled:opacity-50 font-semibold"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleResolve(task.itemId, "approve", inputTask === task.itemId ? inputNotes : undefined)}
                      disabled={resolving === task.itemId}
                      className="text-[10px] px-3 py-1 rounded bg-green-900/30 border border-green-800/50 text-green-400 hover:bg-green-900/50 transition-colors disabled:opacity-50 font-semibold"
                    >
                      Approve
                    </button>
                  </div>
                </div>

                {/* Workflow context + chat link */}
                <div className="flex items-center gap-2 mt-2 text-[10px] text-[var(--text-tertiary)]">
                  <span className="truncate">{task.workflowName}</span>
                  <button
                    onClick={() => onSwitchToAgent?.(task.ownerAgent)}
                    className="ml-auto shrink-0 text-[var(--accent-green)] hover:underline"
                  >
                    Open chat with {task.ownerAgent}
                  </button>
                </div>
              </div>
            ))}
      </div>
      )}

      {/* Artifact Viewer — rendered via portal to escape overflow clipping */}
      {artifactView && typeof document !== "undefined" && createPortal(
        <ArtifactViewer
          workflowItemId={artifactView.workflowItemId}
          focusStage={artifactView.focusStage}
          onClose={() => setArtifactView(null)}
        />,
        document.body
      )}
    </div>
  );
}
