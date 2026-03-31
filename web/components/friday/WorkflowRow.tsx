"use client";

import { useState, useEffect, useRef } from "react";
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
  /** Open pipeline drill-down (Friday ops panel). */
  onSelect?: () => void;
}

const LIFECYCLE_STAGE_COLORS: Record<string, string> = {
  PLANNING: "#6b7280",
  ACTIVE: "#16A34A",
  PAUSED: "#D4A017",
  COMPLETED: "#2563EB",
};

export default function WorkflowCard({ workflow, onSelect }: WorkflowCardProps) {
  const boardLabel = workflow.boardName;
  const owner = resolveOwner(workflow.ownerAgent);
  const stages = workflow.boardStages || [];
  const [showSpec, setShowSpec] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!showSpec) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setShowSpec(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSpec]);

  const lc = (workflow.stage || "").trim().toUpperCase();

  return (
    <div
      className={`bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-2.5 space-y-2 relative ${
        onSelect ? "cursor-pointer hover:border-[var(--text-tertiary)] transition-colors" : ""
      }`}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={
        onSelect
          ? () => {
              onSelect();
            }
          : undefined
      }
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
    >
      {/* Name + info button + alert badge */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-[var(--text-primary)] truncate flex-1">
          {workflow.name}
        </span>
        {workflow.alertCount > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--accent-orange)] text-white font-medium shrink-0">
            {workflow.alertCount}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowSpec(true);
          }}
          className="p-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
          title="View spec"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </button>
      </div>

      {/* Item type + lifecycle + board + owner */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {lc && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full text-white font-medium"
            style={{
              backgroundColor: LIFECYCLE_STAGE_COLORS[lc] || "#555",
            }}
            title="Workflow lifecycle (not board stage)"
          >
            {lc}
          </span>
        )}
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

      {/* Spec popup */}
      {showSpec && (
        <div
          ref={popupRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-[600px] max-w-[90vw] max-h-[80vh] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl shadow-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">{workflow.name}</h2>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full text-white font-medium shrink-0"
                  style={{ backgroundColor: ITEM_TYPE_COLORS[workflow.itemType] || "#555" }}
                >
                  {ITEM_TYPE_LABELS[workflow.itemType] || workflow.itemType}
                </span>
                {owner && (
                  <div className="flex items-center gap-1 shrink-0">
                    <div
                      className="w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: owner.color }}
                    >
                      <span className="text-[8px] font-medium text-white">{owner.name[0]}</span>
                    </div>
                    <span className="text-[10px] text-[var(--text-secondary)]">{owner.name}</span>
                  </div>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setShowSpec(false); }}
                className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Stage pipeline */}
            {stages.length > 0 && (
              <div className="px-4 py-2.5 border-b border-[var(--border-color)] shrink-0">
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
                            <span className="bg-white/25 text-[9px] px-1 rounded-full font-bold">{count}</span>
                          )}
                        </span>
                        {i < stages.length - 1 && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        )}
                      </div>
                    );
                  })}
                  {workflow.totalItems > 0 && (
                    <span className="text-[10px] text-[var(--text-tertiary)] ml-1">{workflow.totalItems} total</span>
                  )}
                </div>
              </div>
            )}

            {/* Spec content */}
            <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
              <label className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold mb-2 block">
                Workflow Spec
              </label>
              {workflow.spec ? (
                <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                  {workflow.spec}
                </div>
              ) : (
                <div className="text-xs text-[var(--text-tertiary)] italic">
                  No spec defined for this workflow.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
