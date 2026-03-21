"use client";

import { WORKFLOW_TYPES } from "@/lib/workflow-types";
import { AGENT_REGISTRY } from "@/lib/agent-registry";

const WORKFLOW_STAGE_COLORS: Record<string, string> = {
  PLANNING: "#6b8a9e",
  ACTIVE: "#1D9E75",
  PAUSED: "#D85A30",
  COMPLETED: "#22c55e",
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  person: "People",
  content: "Content",
};

const ITEM_TYPE_COLORS: Record<string, string> = {
  person: "#2563EB",
  content: "#9B59B6",
};

function resolveOwnerAgents(spec: string): { name: string; color: string }[] {
  const owners: { name: string; color: string }[] = [];
  for (const agent of Object.values(AGENT_REGISTRY)) {
    if (agent.workflowTypes.includes(spec)) {
      owners.push({ name: agent.name, color: agent.color });
    }
  }
  return owners;
}

function timeAgo(date: string | null | undefined): string {
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

export interface WorkflowStat {
  id: string;
  name: string;
  stage: string;
  spec: string;
  itemType: string;
  updatedAt: string | null;
  boardName: string | null;
  boardStages: Array<{ key: string; label: string; color: string }>;
  totalItems: number;
  stageCounts: Record<string, number>;
  alertCount: number;
}

interface WorkflowRowProps {
  workflow: WorkflowStat;
}

export default function WorkflowRow({ workflow }: WorkflowRowProps) {
  const wfStageColor = WORKFLOW_STAGE_COLORS[workflow.stage] || "#555";
  const wfStageLabel = workflow.stage.charAt(0) + workflow.stage.slice(1).toLowerCase();
  const template = WORKFLOW_TYPES[workflow.spec];
  const owners = resolveOwnerAgents(workflow.spec);
  const stages = workflow.boardStages || [];

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-3.5 space-y-2.5">
      {/* Row 1: Name, status, updated */}
      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: wfStageColor }}
          title={wfStageLabel}
        />
        <span className="text-sm font-semibold text-[var(--text-primary)] truncate flex-1">
          {workflow.name}
        </span>
        {workflow.alertCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-orange)] text-white font-medium shrink-0">
            {workflow.alertCount} alert{workflow.alertCount !== 1 ? "s" : ""}
          </span>
        )}
        <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">
          {wfStageLabel}
        </span>
        {workflow.updatedAt && (
          <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">
            {timeAgo(workflow.updatedAt)}
          </span>
        )}
      </div>

      {/* Row 2: Template, item type, agents */}
      <div className="flex items-center gap-2 flex-wrap">
        {template && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-primary)] text-[var(--text-secondary)] font-medium">
            {template.label}
          </span>
        )}
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium"
          style={{ backgroundColor: ITEM_TYPE_COLORS[workflow.itemType] || "#555" }}
        >
          {ITEM_TYPE_LABELS[workflow.itemType] || workflow.itemType}
        </span>
        {owners.length > 0 && (
          <div className="flex items-center gap-1 ml-auto">
            {owners.map((owner) => (
              <div key={owner.name} className="flex items-center gap-1">
                <div
                  className="w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: owner.color }}
                >
                  <span className="text-[8px] font-medium text-white">{owner.name[0]}</span>
                </div>
                <span className="text-[10px] text-[var(--text-secondary)]">{owner.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Row 3: Stage breakdown with item counts */}
      {stages.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          {stages.map((s, i) => {
            const count = workflow.stageCounts[s.key] || 0;
            return (
              <div key={s.key} className="flex items-center gap-1">
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full text-white font-medium inline-flex items-center gap-1"
                  style={{ backgroundColor: s.color }}
                >
                  {s.label}
                  {count > 0 && (
                    <span className="bg-white/25 text-white text-[9px] px-1 rounded-full font-bold">
                      {count}
                    </span>
                  )}
                </span>
                {i < stages.length - 1 && (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--text-tertiary)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
              </div>
            );
          })}
          {/* Total */}
          <span className="text-[10px] text-[var(--text-tertiary)] ml-1">
            {workflow.totalItems} total
          </span>
        </div>
      )}
    </div>
  );
}
