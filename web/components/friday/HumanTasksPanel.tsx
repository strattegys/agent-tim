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
  king: "#5a6d7a",
};

/** Human-readable action labels for each stage that requires human input */
const STAGE_ACTION_LABELS: Record<string, string> = {
  IDEA: "Submit Your Idea",
  AWAITING_CONTACT: "Provide Next Contact",
  CAMPAIGN_SPEC: "Review Campaign Spec",
  REVIEW: "Review Article Draft",
  DRAFT_PUBLISHED: "Review on Site",
  QUALIFICATION: "Review Qualified Target",
  POST_DRAFTED: "Review LinkedIn Post",
  INITIATED: "Review Connection Request",
  MESSAGE_DRAFT: "Review Message Draft",
  MESSAGED: "Review Outreach Message",
  REPLY_DRAFT: "Review Reply Draft",
};

/** Stages where the task is an input form (no artifact to view, just submit) */
const INPUT_ONLY_STAGES = new Set(["IDEA", "AWAITING_CONTACT"]);

/** Stages where Reject doesn't make sense — user chats with agent to refine, then submits */
const NO_REJECT_STAGES = new Set([
  "IDEA",
  "AWAITING_CONTACT",
  "CAMPAIGN_SPEC",
  "REVIEW",
  "DRAFT_PUBLISHED",
]);

/** Notes are never used — all info lives in artifacts */

interface HumanTask {
  itemId: string;
  itemTitle: string;
  itemSubtitle: string;
  workflowId: string;
  workflowName: string;
  packageName: string;
  ownerAgent: string;
  packageId: string | null;
  workflowType: string;
  stage: string;
  stageLabel: string;
  humanAction: string;
  dueDate: string | null;
  itemType: string;
  createdAt: string;
}

function taskStageHeading(task: HumanTask): string {
  if (task.stage === "MESSAGED" && task.workflowType === "warm-outreach") {
    return "Follow-up or mark replied";
  }
  return STAGE_ACTION_LABELS[task.stage] || task.stageLabel;
}

interface HumanTasksPanelProps {
  onSwitchToAgent?: (agentId: string) => void;
  /** Filter to only show tasks from packages at this stage. Default: no filter (all tasks). */
  packageStageFilter?: string;
  /** When true, hides the panel header/tabs — used when embedded inline */
  compact?: boolean;
}

const POLL_INTERVAL = 5000;

export default function HumanTasksPanel({ onSwitchToAgent, packageStageFilter, compact }: HumanTasksPanelProps) {
  const [tasks, setTasks] = useState<HumanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [artifactView, setArtifactView] = useState<{ workflowItemId: string; focusStage?: string; workflowName?: string; agentId?: string; taskItemId?: string; taskStage?: string } | null>(null);
  const [ideaInput, setIdeaInput] = useState("");
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
  }, [packageStageFilter]);

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
    async (
      itemId: string,
      action: "approve" | "reject" | "input" | "replied" | "ended",
      notes?: string
    ) => {
      setResolving(itemId);
      try {
        const res = await fetch("/api/crm/human-tasks/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, action, notes: notes || undefined }),
        });
        const data = await res.json();
        if (data.ok) {
          // Append logs to sessionStorage for the Logs panel
          if (data.logs && data.logs.length > 0) {
            try {
              // Find the package ID for this task's workflow
              const task = tasks.find(t => t.itemId === itemId);
              if (task) {
                // Try to find the packageId from the workflow
                const wfRes = await fetch(`/api/crm/workflow-items?workflowItemId=${itemId}`);
                const wfData = await wfRes.json();
                const packageId = wfData.packageId;
                if (packageId) {
                  const key = `simLog-${packageId}`;
                  const existing = JSON.parse(sessionStorage.getItem(key) || "[]");
                  sessionStorage.setItem(key, JSON.stringify([...existing, ...data.logs]));
                }
              }
            } catch { /* ignore log storage failures */ }
          }
          // Remove the task from the list immediately
          setTasks((prev) => prev.filter((t) => t.itemId !== itemId));
          setIdeaInput("");
          // Re-fetch to get accurate state
          setTimeout(fetchTasks, 500);
        }
      } catch {
        // ignore
      }
      setResolving(null);
    },
    [fetchTasks, tasks]
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
      {/* Now / Later tabs — hidden in compact mode */}
      {!compact && <div className="flex items-center gap-1 px-3 pt-3 pb-2 shrink-0">
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
      </div>}

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
                {/* Task header */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                      {task.packageName ? `${task.packageName} — ` : ""}{taskStageHeading(task)}
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
                  </div>
                  <span className="text-[10px] text-[var(--text-tertiary)] shrink-0 truncate max-w-[120px]">{task.workflowName}</span>
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

                {/* Input area — IDEA + warm contact intake */}
                {INPUT_ONLY_STAGES.has(task.stage) && (
                  <div className="mb-3">
                    <textarea
                      value={ideaInput}
                      onChange={(e) => setIdeaInput(e.target.value)}
                      placeholder={
                        task.stage === "AWAITING_CONTACT"
                          ? "Name, LinkedIn URL, how you know them, and any relevant notes..."
                          : "Describe your article idea — topic, angle, or rough concept..."
                      }
                      className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-2 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] resize-none focus:outline-none focus:border-amber-500/50"
                      rows={3}
                    />
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  {/* View Artifacts — only for stages that have artifacts (not IDEA) */}
                  {!INPUT_ONLY_STAGES.has(task.stage) && (
                    <button
                      onClick={() => setArtifactView({ workflowItemId: task.itemId, focusStage: undefined, workflowName: task.workflowName, agentId: task.ownerAgent, taskItemId: task.itemId, taskStage: task.stage })}
                      className="text-[10px] px-2.5 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)] transition-colors"
                    >
                      View Artifacts
                    </button>
                  )}

                  <div className="flex items-center flex-wrap justify-end gap-1.5 ml-auto">
                    {task.stage === "MESSAGED" && task.workflowType === "warm-outreach" && (
                      <button
                        type="button"
                        onClick={() => handleResolve(task.itemId, "replied")}
                        disabled={resolving === task.itemId}
                        className="text-[10px] px-3 py-1 rounded bg-blue-900/30 border border-blue-800/50 text-blue-300 hover:bg-blue-900/50 transition-colors disabled:opacity-50 font-semibold"
                      >
                        Replied
                      </button>
                    )}
                    {task.stage === "REPLY_DRAFT" && task.workflowType === "warm-outreach" && (
                      <button
                        type="button"
                        onClick={() => handleResolve(task.itemId, "ended")}
                        disabled={resolving === task.itemId}
                        className="text-[10px] px-3 py-1 rounded bg-zinc-800 border border-zinc-600 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-50 font-semibold"
                      >
                        End Sequence
                      </button>
                    )}
                    {/* Reject — only for stages where it makes sense */}
                    {!NO_REJECT_STAGES.has(task.stage) && (
                      <button
                        type="button"
                        onClick={() => handleResolve(task.itemId, "reject")}
                        disabled={resolving === task.itemId}
                        className="text-[10px] px-3 py-1 rounded bg-red-900/30 border border-red-800/50 text-red-400 hover:bg-red-900/50 transition-colors disabled:opacity-50 font-semibold"
                      >
                        Reject
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleResolve(
                        task.itemId,
                        INPUT_ONLY_STAGES.has(task.stage) ? "input" : "approve",
                        INPUT_ONLY_STAGES.has(task.stage) ? ideaInput : undefined
                      )}
                      disabled={resolving === task.itemId || (INPUT_ONLY_STAGES.has(task.stage) && (!ideaInput || !ideaInput.trim()))}
                      className="text-[10px] px-3 py-1 rounded bg-green-900/30 border border-green-800/50 text-green-400 hover:bg-green-900/50 transition-colors disabled:opacity-50 font-semibold"
                    >
                      {task.stage === "MESSAGED" && task.workflowType === "warm-outreach"
                        ? "Continue"
                        : "Submit"}
                    </button>
                  </div>
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
          title={artifactView.workflowName}
          agentId={artifactView.agentId}
          onSubmitTask={artifactView.taskItemId ? async () => {
            await fetch("/api/crm/human-tasks/resolve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itemId: artifactView.taskItemId, action: "approve" }),
            });
            fetchTasks();
          } : undefined}
          onClose={() => setArtifactView(null)}
        />,
        document.body
      )}
    </div>
  );
}
