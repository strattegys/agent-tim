"use client";

import type { WorkflowWithBoard } from "@/lib/board-types";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";
import { AGENT_REGISTRY } from "@/lib/agent-registry";

const STAGE_COLORS: Record<string, string> = {
  PLANNING: "#6b8a9e",
  ACTIVE: "#1D9E75",
  PAUSED: "#D85A30",
  COMPLETED: "#22c55e",
};

function resolveOwnerAgent(spec: string): { name: string; color: string } | null {
  for (const agent of Object.values(AGENT_REGISTRY)) {
    if (agent.workflowTypes.includes(spec)) {
      return { name: agent.name, color: agent.color };
    }
  }
  return null;
}

function timeAgo(date: string | undefined): string {
  if (!date) return "";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface WorkflowRowProps {
  workflow: WorkflowWithBoard & { updatedAt?: string };
}

export default function WorkflowRow({ workflow }: WorkflowRowProps) {
  const stageColor = STAGE_COLORS[workflow.stage] || "#555";
  const stageLabel = workflow.stage.charAt(0) + workflow.stage.slice(1).toLowerCase();
  const template = WORKFLOW_TYPES[workflow.spec];
  const owner = resolveOwnerAgent(workflow.spec);

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-3.5 py-2.5 flex items-center gap-3">
      {/* Status dot */}
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: stageColor }}
        title={stageLabel}
      />

      {/* Name + template */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--text-primary)] truncate">
          {workflow.name}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {template && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-primary)] text-[var(--text-secondary)] font-medium">
              {template.label}
            </span>
          )}
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {stageLabel}
          </span>
        </div>
      </div>

      {/* Owner agent */}
      {owner && (
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center"
            style={{ backgroundColor: owner.color }}
          >
            <span className="text-[9px] font-medium text-white">
              {owner.name[0]}
            </span>
          </div>
          <span className="text-[10px] text-[var(--text-secondary)]">
            {owner.name}
          </span>
        </div>
      )}

      {/* Updated */}
      {workflow.updatedAt && (
        <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">
          {timeAgo(workflow.updatedAt)}
        </span>
      )}
    </div>
  );
}
