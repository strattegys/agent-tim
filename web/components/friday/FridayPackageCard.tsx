"use client";

import Link from "next/link";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";
import { getAgentSpec } from "@/lib/agent-registry";
import AgentAvatar from "../AgentAvatar";

export interface FridayWorkflowBreakdownStage {
  key: string;
  label: string;
  color: string;
  requiresHuman?: boolean;
}

export interface FridayWorkflowBreakdown {
  id: string;
  name: string;
  ownerAgent: string;
  workflowType: string;
  targetCount: number;
  /** Package planner line (e.g. five messages/day) */
  volumeLabel?: string | null;
  totalItems: number;
  stageCounts: Record<string, number>;
  stages: FridayWorkflowBreakdownStage[];
}

export interface FridayPackageRow {
  id: string;
  name: string;
  templateId: string;
  stage: string;
  /** Human-friendly id for chat */
  packageNumber?: number | null;
  workflowCount: number;
  itemCount?: number;
  createdAt: string;
  /** Per-workflow pipeline steps + counts (when API sends includeWorkflowBreakdown) */
  workflows?: FridayWorkflowBreakdown[];
}

interface FridayPackageCardProps {
  pkg: FridayPackageRow;
}

function stageCount(map: Record<string, number>, key: string): number {
  const u = key.toUpperCase();
  return map[u] ?? map[key] ?? 0;
}

function HumanStepIcon({ className }: { className?: string }) {
  return (
    <svg
      width="7"
      height="7"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className={`opacity-75 shrink-0 ${className || ""}`}
      aria-hidden
    >
      <circle cx="12" cy="7" r="4" />
      <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

export default function FridayPackageCard({ pkg }: FridayPackageCardProps) {
  const items = pkg.itemCount ?? 0;
  const breakdown = pkg.workflows && pkg.workflows.length > 0 ? pkg.workflows : null;
  const awaitingContactTotal =
    breakdown?.reduce((sum, wf) => sum + stageCount(wf.stageCounts, "AWAITING_CONTACT"), 0) ??
    0;
  const timHumanStagesTotal =
    breakdown?.reduce((sum, wf) => {
      if (wf.ownerAgent?.toLowerCase() !== "tim" || !wf.workflowType) return sum;
      const spec = WORKFLOW_TYPES[wf.workflowType];
      if (!spec) return sum;
      let n = 0;
      for (const st of spec.defaultBoard.stages) {
        if (st.requiresHuman) n += stageCount(wf.stageCounts, st.key);
      }
      return sum + n;
    }, 0) ?? 0;

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 min-w-0">
        {pkg.packageNumber != null && !Number.isNaN(pkg.packageNumber) && (
          <span className="text-[10px] font-bold tabular-nums text-[var(--text-tertiary)] shrink-0">
            #{pkg.packageNumber}
          </span>
        )}
        <span className="text-xs font-semibold text-[var(--text-primary)] truncate flex-1">{pkg.name}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap text-[9px] text-[var(--text-tertiary)]">
        <span className="px-1.5 py-0.5 rounded bg-[var(--bg-primary)] font-medium">{pkg.templateId}</span>
        <span>
          {pkg.workflowCount} workflow{pkg.workflowCount !== 1 ? "s" : ""}
          {pkg.itemCount != null ? ` · ${items} item${items !== 1 ? "s" : ""}` : ""}
        </span>
      </div>

      {pkg.stage === "ACTIVE" &&
        (timHumanStagesTotal > 0 || awaitingContactTotal > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/?agent=tim&panel=messages"
            scroll={false}
            className="text-[10px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
            title="Opens Tim’s work queue (messages, approvals, next-contact slots)"
          >
            Work in Tim → Work queue
            {awaitingContactTotal > 0
              ? ` (${awaitingContactTotal} awaiting contact)`
              : ` (${timHumanStagesTotal} task${timHumanStagesTotal !== 1 ? "s" : ""})`}
          </Link>
          <Link
            href="/?agent=tim&panel=kanban"
            scroll={false}
            className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:underline"
            title="Pick your workflow in the dropdown to see cards by stage"
          >
            Pipeline board
          </Link>
        </div>
      )}

      {breakdown &&
        breakdown.map((wf) => {
          const typeLabel =
            (wf.workflowType && WORKFLOW_TYPES[wf.workflowType]?.label) || wf.name || "Workflow";
          const ownerId = (wf.ownerAgent || "tim").toLowerCase();
          const agentSpec = getAgentSpec(ownerId);
          const vol = typeof wf.volumeLabel === "string" ? wf.volumeLabel.trim() : "";
          const cap = wf.targetCount > 0 ? wf.targetCount : null;
          const goalLine =
            vol && cap
              ? `${vol} · up to ${cap} contact${cap !== 1 ? "s" : ""} in flight`
              : vol
                ? vol
                : cap
                  ? `Up to ${cap} contact${cap !== 1 ? "s" : ""} in flight`
                  : null;

          return (
            <div
              key={wf.id}
              className="pt-2 mt-1 border-t border-[var(--border-color)] space-y-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="rounded-full shrink-0 opacity-90"
                  style={{ padding: "1px", background: `${agentSpec.color}55` }}
                >
                  <AgentAvatar
                    agentId={ownerId}
                    name={agentSpec.name}
                    color={agentSpec.color}
                    circleClassName="w-7 h-7 min-w-[28px] min-h-[28px]"
                    initialClassName="text-xs font-semibold text-white"
                  />
                </span>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[11px] font-semibold text-[var(--text-primary)] leading-tight truncate">
                    {typeLabel}
                  </span>
                  <span className="text-[9px] text-[var(--text-tertiary)] capitalize truncate">
                    {ownerId} · {wf.totalItems} in pipeline
                    {goalLine ? ` · ${goalLine}` : ""}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 items-center">
                {wf.stages.map((s, i) => {
                  const n = stageCount(wf.stageCounts, s.key);
                  const expanded = s.requiresHuman === true;
                  return (
                    <div key={s.key} className="flex items-center gap-0.5">
                      <span
                        title={`${s.label}: ${n} item(s)${expanded ? " · human step" : ""}`}
                        className="text-[9px] px-1.5 py-0.5 rounded-md font-medium border inline-flex items-center gap-0.5 max-w-[9.5rem]"
                        style={{
                          backgroundColor: n > 0 ? `${s.color}22` : "var(--bg-primary)",
                          borderColor: n > 0 ? `${s.color}40` : "var(--border-color)",
                          color: n > 0 ? "var(--text-primary)" : "var(--text-tertiary)",
                        }}
                      >
                        {expanded && <HumanStepIcon />}
                        <span className="truncate">{s.label}</span>
                        <span className="tabular-nums font-bold text-[11px] shrink-0">{n}</span>
                      </span>
                      {i < wf.stages.length - 1 && (
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--text-tertiary)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="shrink-0 opacity-80"
                          aria-hidden
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
    </div>
  );
}
