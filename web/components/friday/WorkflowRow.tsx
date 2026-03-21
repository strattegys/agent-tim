"use client";

import { AGENT_REGISTRY } from "@/lib/agent-registry";

const ITEM_TYPE_LABELS: Record<string, string> = {
  person: "People",
  content: "Content",
};

const ITEM_TYPE_COLORS: Record<string, string> = {
  person: "#2563EB",
  content: "#9B59B6",
};

function resolveOwner(ownerAgent: string | null): { name: string; color: string } | null {
  if (!ownerAgent) return null;
  const agent = AGENT_REGISTRY[ownerAgent];
  if (!agent) return null;
  return { name: agent.name, color: agent.color };
}

export interface WorkflowStat {
  id: string;
  name: string;
  stage: string;
  spec: string;
  itemType: string;
  ownerAgent: string | null;
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
  const boardLabel = workflow.boardName;
  const owner = resolveOwner(workflow.ownerAgent);
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

      {/* Item type + board + owner */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-full text-white font-medium"
          style={{ backgroundColor: ITEM_TYPE_COLORS[workflow.itemType] || "#555" }}
        >
          {ITEM_TYPE_LABELS[workflow.itemType] || workflow.itemType}
        </span>
        {boardLabel && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-primary)] text-[var(--text-secondary)] font-medium">
            {boardLabel}
          </span>
        )}
        {owner && (
          <div className="flex items-center gap-1 ml-auto">
            <div
              className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: owner.color }}
            >
              <span className="text-[8px] font-medium text-white">{owner.name[0]}</span>
            </div>
            <span className="text-[9px] text-[var(--text-secondary)]">{owner.name}</span>
          </div>
        )}
      </div>

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
