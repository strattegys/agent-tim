"use client";

import { useState } from "react";
import Link from "next/link";
import OperationalPackageEditModal from "./OperationalPackageEditModal";
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
  /** When set (operational packages API), human-readable workflow template name */
  workflowTypeLabel?: string | null;
  /** From workflow type registry when API includes it */
  itemType?: "person" | "content";
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
  /** Raw package spec (name/brief PATCH) — included on operational GET */
  spec?: unknown;
  /** Per-workflow pipeline steps + counts (when API sends includeWorkflowBreakdown) */
  workflows?: FridayWorkflowBreakdown[];
}

interface FridayPackageCardProps {
  pkg: FridayPackageRow;
  /** Open full Kanban for this workflow (Friday queue drill-down). */
  onOpenWorkflowKanban?: (wf: FridayWorkflowBreakdown) => void;
  /** After PATCH from edit modal — refresh operational list */
  onPackageMutate?: () => void;
}

function stageCount(map: Record<string, number>, key: string): number {
  const u = key.toUpperCase();
  return map[u] ?? map[key] ?? 0;
}

function HumanStepIcon({ className, size = 12 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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

function timHumanStagesCountForWorkflow(wf: FridayWorkflowBreakdown): number {
  if (wf.ownerAgent?.toLowerCase() !== "tim") return 0;
  let n = 0;
  for (const st of wf.stages) {
    if (st.requiresHuman) n += stageCount(wf.stageCounts, st.key);
  }
  return n;
}

/** One workflow’s pipeline strip (used inside package queue cards). */
export function FridayWorkflowPipelineBlock({
  wf,
  onOpenBoard,
}: {
  wf: FridayWorkflowBreakdown;
  onOpenBoard?: () => void;
}) {
  const typeLabel =
    (typeof wf.workflowTypeLabel === "string" && wf.workflowTypeLabel.trim()) ||
    wf.name ||
    "Workflow";
  const ownerId = (wf.ownerAgent || "tim").toLowerCase();
  const agentSpec = getAgentSpec(ownerId);
  const itemType = wf.itemType ?? "person";
  const vol = typeof wf.volumeLabel === "string" ? wf.volumeLabel.trim() : "";
  const cap = wf.targetCount > 0 ? wf.targetCount : null;
  const flightNoun =
    itemType === "content" ? (cap === 1 ? "article" : "articles") : cap === 1 ? "contact" : "contacts";
  const goalLine =
    vol && cap
      ? `${vol} · up to ${cap} ${flightNoun} in flight`
      : vol
        ? vol
        : cap
          ? `Up to ${cap} ${flightNoun} in flight`
          : null;
  const pipelineNoun =
    itemType === "content"
      ? wf.totalItems === 1
        ? "article"
        : "articles"
      : wf.totalItems === 1
        ? "item"
        : "items";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="rounded-full shrink-0 opacity-90"
          style={{ padding: "1px", background: `${agentSpec.color}55` }}
        >
          <AgentAvatar
            agentId={ownerId}
            name={agentSpec.name}
            color={agentSpec.color}
            circleClassName="w-8 h-8 min-w-[32px] min-h-[32px]"
            initialClassName="text-sm font-semibold text-white"
          />
        </span>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[11px] font-medium text-[var(--text-chat-body)] leading-tight truncate">
            {typeLabel}
          </span>
          <span className="text-[9px] text-[var(--text-tertiary)] capitalize truncate">
            {ownerId} · {wf.totalItems} {pipelineNoun} in pipeline
            {goalLine ? ` · ${goalLine}` : ""}
          </span>
        </div>
        {onOpenBoard ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenBoard();
            }}
            className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)] cursor-pointer"
            title="Open Kanban board for this workflow"
          >
            Board
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-1.5 gap-y-2 items-center">
        {wf.stages.map((s, i) => {
          const n = stageCount(wf.stageCounts, s.key);
          const expanded = s.requiresHuman === true;
          return (
            <div key={s.key} className="flex items-center gap-1">
              <span
                title={`${s.label}: ${n} item(s)${expanded ? " · human step" : ""}`}
                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-2 inline-flex flex-col items-stretch gap-1.5 min-w-[5.25rem] max-w-[11rem] shadow-sm"
                style={{
                  color: n > 0 ? "var(--text-secondary)" : "var(--text-tertiary)",
                }}
              >
                <span className="flex items-start gap-1.5 min-h-[2.25rem]">
                  {expanded ? (
                    <HumanStepIcon size={12} className="text-[var(--text-tertiary)] mt-0.5" />
                  ) : null}
                  <span className="text-[11px] font-medium leading-snug line-clamp-2 break-words text-[var(--text-primary)]">
                    {s.label}
                  </span>
                </span>
                <span className="tabular-nums font-semibold text-sm text-center border-t border-[var(--border-color)]/60 pt-1.5 -mx-0.5 px-0.5">
                  {n}
                </span>
              </span>
              {i < wf.stages.length - 1 && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--text-tertiary)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 opacity-80 self-center"
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
}

export default function FridayPackageCard({
  pkg,
  onOpenWorkflowKanban,
  onPackageMutate,
}: FridayPackageCardProps) {
  const [editOpen, setEditOpen] = useState(false);
  const items = pkg.itemCount ?? 0;
  const breakdown = pkg.workflows && pkg.workflows.length > 0 ? pkg.workflows : null;
  const awaitingContactTotal =
    breakdown?.reduce((sum, wf) => sum + stageCount(wf.stageCounts, "AWAITING_CONTACT"), 0) ??
    0;
  const timHumanStagesTotal =
    breakdown?.reduce((sum, wf) => sum + timHumanStagesCountForWorkflow(wf), 0) ?? 0;

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-2.5 space-y-1.5">
      <OperationalPackageEditModal
        pkg={{
          id: pkg.id,
          name: pkg.name,
          templateId: pkg.templateId,
          stage: pkg.stage,
          spec: pkg.spec ?? {},
        }}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => onPackageMutate?.()}
      />
      <div className="flex items-center gap-1.5 min-w-0">
        {pkg.packageNumber != null && !Number.isNaN(pkg.packageNumber) && (
          <span className="text-[10px] font-bold tabular-nums text-[var(--text-tertiary)] shrink-0">
            #{pkg.packageNumber}
          </span>
        )}
        <span className="text-xs font-medium text-[var(--text-chat-body)] truncate flex-1">{pkg.name}</span>
        <button
          type="button"
          title="Edit name, brief, or move to draft"
          onClick={() => setEditOpen(true)}
          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)]"
        >
          Edit
        </button>
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
            title="Opens Tim’s work panel (Active Work Queue + Pending Work Queue tabs)"
          >
            Work in Tim
            {awaitingContactTotal > 0
              ? ` (${awaitingContactTotal} awaiting contact)`
              : ` (${timHumanStagesTotal} task${timHumanStagesTotal !== 1 ? "s" : ""})`}
          </Link>
        </div>
      )}

      {breakdown &&
        breakdown.map((wf) => (
          <div
            key={wf.id}
            className="pt-2 mt-1 border-t border-[var(--border-color)] space-y-2"
          >
            <FridayWorkflowPipelineBlock
              wf={wf}
              onOpenBoard={
                onOpenWorkflowKanban ? () => onOpenWorkflowKanban(wf) : undefined
              }
            />
          </div>
        ))}
    </div>
  );
}
