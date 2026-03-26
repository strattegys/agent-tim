"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { panelBus } from "@/lib/events";
import { getAgentSpec } from "@/lib/agent-registry";
import AgentAvatar from "../AgentAvatar";
import ArtifactViewer from "../shared/ArtifactViewer";

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
  /** Package for sim logs — use this directly (workflow-items API has no workflowItemId lookup) */
  packageId: string | null;
  /** Human-friendly id for chat (“package #12”) */
  packageNumber?: number | null;
  /** _package.stage when workflow is linked to a package */
  packageStage?: string | null;
  /** True when package exists and stage is ACTIVE */
  inActiveCampaign?: boolean;
  workflowType: string;
  stage: string;
  stageLabel: string;
  humanAction: string;
  dueDate: string | null;
  itemType: string;
  createdAt: string;
  waitingFollowUp?: boolean;
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
    fetch(`/api/crm/human-tasks${packageStageFilter ? `?packageStage=${packageStageFilter}` : ""}`, {
      credentials: "include",
    })
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
      if (resolving) return;
      setResolving(itemId);
      try {
        const res = await fetch("/api/crm/human-tasks/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, action, notes: notes || undefined }),
        });
        const data = await res.json();
        const pushLogsToPackage = (logs: string[], resolvedPackageId: string | null | undefined) => {
          if (!logs?.length) return;
          const packageId = resolvedPackageId ?? undefined;
          if (!packageId) return;
          try {
            const key = `simLog-${packageId}`;
            const existing = JSON.parse(sessionStorage.getItem(key) || "[]");
            const merged = [...[...logs].reverse(), ...existing];
            sessionStorage.setItem(key, JSON.stringify(merged));
            panelBus.emit("sim_log");
          } catch {
            /* ignore */
          }
        };

        const taskRow = tasks.find((t) => t.itemId === itemId);
        const resolvedPackageId =
          (data as { packageId?: string | null }).packageId ?? taskRow?.packageId ?? null;

        if (data.ok) {
          if (data.logs?.length) pushLogsToPackage(data.logs, resolvedPackageId);
          setTasks((prev) => prev.filter((t) => t.itemId !== itemId));
          setIdeaInput("");
          setTimeout(fetchTasks, 500);
        } else {
          const failLines = [
            `[${new Date().toISOString()}] Task resolve failed: ${data.error || res.status}`,
            ...(data.logs || []),
            ...(data.detail ? [`Detail: ${data.detail}`] : []),
          ];
          pushLogsToPackage(failLines, resolvedPackageId);
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

  const tabBtnClass = (active: boolean) =>
    `text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
      active
        ? "font-semibold text-[var(--text-primary)]"
        : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
    }`;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Now / Later — Suzi-style text tabs (shown in compact Package Planner embed too) */}
      <div
        className={`flex items-center gap-2 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] ${
          compact ? "px-2 py-1" : "px-3 py-2"
        }`}
      >
        <button type="button" onClick={() => setTab("now")} className={tabBtnClass(tab === "now")}>
          Now
          {nowTasks.length > 0 && (
            <span className="ml-1 text-[10px] font-normal text-[var(--text-tertiary)] tabular-nums">
              {nowTasks.length}
            </span>
          )}
        </button>
        <button type="button" onClick={() => setTab("later")} className={tabBtnClass(tab === "later")}>
          Later
          {laterTasks.length > 0 && (
            <span className="ml-1 text-[10px] font-normal text-[var(--text-tertiary)] tabular-nums">
              {laterTasks.length}
            </span>
          )}
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
      <div className={`flex-1 overflow-y-auto space-y-2 ${compact ? "px-2 py-2" : "px-3 py-2 pb-3"}`}>
          {visibleTasks.map((task) => {
            const ownerSpec = getAgentSpec(task.ownerAgent);
            return (
              <div
                key={task.itemId}
                className="rounded-lg p-3 border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:border-[var(--text-tertiary)]/25 transition-colors"
              >
                {/* Task header */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                      {task.packageNumber != null && !Number.isNaN(task.packageNumber)
                        ? `#${task.packageNumber} `
                        : ""}
                      {task.packageName ? `${task.packageName} — ` : ""}
                      {taskStageHeading(task)}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span
                        className="rounded-full shrink-0"
                        style={{
                          padding: "1.5px",
                          background: ownerSpec.color,
                        }}
                      >
                        <AgentAvatar
                          agentId={task.ownerAgent}
                          name={ownerSpec.name}
                          color={ownerSpec.color}
                          circleClassName="w-4 h-4 min-w-[16px] min-h-[16px]"
                          initialClassName="text-[9px] font-semibold text-white leading-none"
                        />
                      </span>
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
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="shrink-0 mt-0.5 text-[var(--text-tertiary)] opacity-70"
                  >
                    <circle cx="12" cy="7" r="4" />
                    <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
                  </svg>
                  <span className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
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
                      className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-2 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] resize-none focus:outline-none focus:border-[var(--text-tertiary)]"
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
                        className="text-[10px] px-2.5 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)] transition-colors disabled:opacity-50 font-medium"
                      >
                        Replied
                      </button>
                    )}
                    {task.stage === "REPLY_DRAFT" && task.workflowType === "warm-outreach" && (
                      <button
                        type="button"
                        onClick={() => handleResolve(task.itemId, "ended")}
                        disabled={resolving === task.itemId}
                        className="text-[10px] px-2.5 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50 font-medium"
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
                        className="text-[10px] px-2.5 py-1 rounded-md border border-red-500/20 bg-red-500/5 text-red-400/90 hover:bg-red-500/10 transition-colors disabled:opacity-50 font-medium"
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
                      className="text-[10px] px-2.5 py-1 rounded-md border border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-green)]/15 transition-colors disabled:opacity-50 font-medium"
                    >
                      {task.stage === "MESSAGED" && task.workflowType === "warm-outreach"
                        ? "Continue"
                        : "Submit"}
                    </button>
                  </div>
                </div>

              </div>
            );
          })}
      </div>
      )}

      {/* Artifact Viewer — rendered via portal to escape overflow clipping */}
      {artifactView && typeof document !== "undefined" && createPortal(
        <ArtifactViewer
          workflowItemId={artifactView.workflowItemId}
          focusStage={artifactView.focusStage}
          title={artifactView.workflowName}
          agentId={artifactView.agentId}
          onSubmitTask={
            artifactView.taskItemId
              ? () => handleResolve(artifactView.taskItemId!, "approve")
              : undefined
          }
          onClose={() => setArtifactView(null)}
        />,
        document.body
      )}
    </div>
  );
}
