"use client";

import { WORKFLOW_TYPES } from "@/lib/workflow-types";
import { AGENT_REGISTRY } from "@/lib/agent-registry";

const ITEM_TYPE_LABELS: Record<string, string> = {
  person: "People",
  content: "Content",
};

const ITEM_TYPE_COLORS: Record<string, string> = {
  person: "#2563EB",
  content: "#9B59B6",
};

/** Try to match a workflow to a template by slug, then by itemType */
function resolveTemplate(spec: string, itemType: string): string | null {
  // Direct slug match
  if (WORKFLOW_TYPES[spec]) return WORKFLOW_TYPES[spec].label;
  // Fall back: find first template matching itemType
  for (const t of Object.values(WORKFLOW_TYPES)) {
    if (t.itemType === itemType) return t.label;
  }
  return null;
}

/** Find agents whose workflowTypes match the workflow's itemType-based templates */
function resolveOwnerAgents(spec: string, itemType: string): { name: string; color: string }[] {
  const owners: { name: string; color: string }[] = [];
  for (const agent of Object.values(AGENT_REGISTRY)) {
    // Direct slug match
    if (agent.workflowTypes.includes(spec)) {
      owners.push({ name: agent.name, color: agent.color });
      continue;
    }
    // Match by itemType — check if agent has any template of this itemType
    for (const wt of agent.workflowTypes) {
      const tmpl = WORKFLOW_TYPES[wt];
      if (tmpl && tmpl.itemType === itemType) {
        owners.push({ name: agent.name, color: agent.color });
        break;
      }
    }
  }
  return owners;
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

interface WorkflowCardProps {
  workflow: WorkflowStat;
}

export default function WorkflowCard({ workflow }: WorkflowCardProps) {
  const templateLabel = resolveTemplate(workflow.spec, workflow.itemType);
  const boardLabel = workflow.boardName;
  const owners = resolveOwnerAgents(workflow.spec, workflow.itemType);
  const stages = workflow.boardStages || [];

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-2.5 space-y-2">
      {/* Name + alert badge */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-[var(--text-primary)] truncate flex-1">
          {workflow.name}
        </span>
        {workflow.alertCount > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--accent-orange)] text-white font-medium shrink-0">
            {workflow.alertCount}
          </span>
        )}
      </div>

      {/* Item type + board/template */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-full text-white font-medium"
          style={{ backgroundColor: ITEM_TYPE_COLORS[workflow.itemType] || "#555" }}
        >
          {ITEM_TYPE_LABELS[workflow.itemType] || workflow.itemType}
        </span>
        {(boardLabel || templateLabel) && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-primary)] text-[var(--text-secondary)] font-medium">
            {boardLabel || templateLabel}
          </span>
        )}
      </div>

      {/* Assigned agents */}
      {owners.length > 0 && (
        <div className="flex items-center gap-1.5">
          {owners.map((owner) => (
            <div key={owner.name} className="flex items-center gap-1">
              <div
                className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: owner.color }}
              >
                <span className="text-[8px] font-medium text-white">{owner.name[0]}</span>
              </div>
              <span className="text-[9px] text-[var(--text-secondary)]">{owner.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Stage pipeline bubbles (shown when workflow is active) */}
      {stages.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          {stages.map((s) => {
            const count = workflow.stageCounts[s.key] || 0;
            return (
              <span
                key={s.key}
                className="text-[8px] px-1.5 py-0.5 rounded-full font-medium inline-flex items-center gap-0.5"
                style={{
                  backgroundColor: count > 0 ? s.color : "transparent",
                  color: count > 0 ? "white" : "var(--text-tertiary)",
                  border: count > 0 ? "none" : "1px solid var(--border-color)",
                }}
                title={`${s.label}: ${count}`}
              >
                {s.label}
                {count > 0 && (
                  <span className="bg-white/25 text-[8px] px-0.5 rounded-full font-bold">
                    {count}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Total items */}
      {workflow.totalItems > 0 && (
        <div className="text-[9px] text-[var(--text-tertiary)]">
          {workflow.totalItems} item{workflow.totalItems !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
