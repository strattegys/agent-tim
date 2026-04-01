"use client";

import { useState, type ReactNode } from "react";
import type { WorkflowTypeSpec } from "@/lib/workflow-types";

const ITEM_TYPE_LABELS: Record<string, string> = {
  person: "People",
  content: "Content",
};

const ITEM_TYPE_COLORS: Record<string, string> = {
  person: "#2563EB",
  content: "#9B59B6",
};

interface WorkflowTemplateCardProps {
  template: WorkflowTypeSpec;
  /** e.g. "New type" for CRM-defined types */
  badge?: string;
  footer?: ReactNode;
}

export default function WorkflowTemplateCard({ template, badge, footer }: WorkflowTemplateCardProps) {
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const stages = template.defaultBoard.stages;

  const typeColor = ITEM_TYPE_COLORS[template.itemType] || "#6b7280";

  return (
    <div className="h-full min-h-[11rem] flex flex-col bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl p-3 shadow-sm hover:border-[var(--text-tertiary)]/25 transition-colors space-y-2">
      {/* Header row: label + badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          {template.label}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] inline-flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: typeColor, opacity: 0.75 }}
          />
          {ITEM_TYPE_LABELS[template.itemType] || template.itemType}
        </span>
        {badge ? (
          <span className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-tertiary)] font-medium uppercase tracking-wide">
            {badge}
          </span>
        ) : null}
        <span className="text-[10px] text-[var(--text-tertiary)] font-mono ml-auto">
          {template.id}
        </span>
      </div>

      {/* Description */}
      <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed line-clamp-2">
        {template.description}
      </p>

      {footer ? <div className="flex flex-wrap gap-2 items-center">{footer}</div> : null}

      {/* Stage pipeline — clickable */}
      <div className="flex flex-wrap gap-1.5 items-center">
        {stages.map((s, i) => {
          const isExpanded = expandedStage === s.key;
          return (
            <div key={s.key} className="flex items-center gap-1">
              <button
                onClick={() => setExpandedStage(isExpanded ? null : s.key)}
                className="text-[9px] px-1.5 py-0.5 rounded-md font-medium border transition-colors flex items-center gap-0.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                style={{
                  backgroundColor: `${s.color}14`,
                  borderColor: isExpanded ? "var(--text-tertiary)" : `${s.color}35`,
                }}
                title={s.instructions}
              >
                {s.requiresHuman && (
                  <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="opacity-70">
                    <circle cx="12" cy="7" r="4" />
                    <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
                  </svg>
                )}
                {s.label}
              </button>
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
      </div>

      {/* Expanded instructions for selected stage */}
      {expandedStage && (() => {
        const stage = stages.find((s) => s.key === expandedStage);
        if (!stage) return null;
        return (
          <div className="rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] p-2">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0 opacity-70"
                style={{ backgroundColor: stage.color }}
              />
              <span className="text-[11px] font-medium text-[var(--text-primary)]">
                {stage.label}
              </span>
              {stage.requiresHuman && (
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] font-medium uppercase tracking-wide">
                  Human required
                </span>
              )}
              <span className="text-[10px] text-[var(--text-tertiary)] font-mono ml-auto">
                {stage.key}
              </span>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              {stage.instructions}
            </p>
            {stage.requiresHuman && stage.humanAction && (
              <div className="mt-2 pt-2 border-t border-[var(--border-color)]">
                <div className="flex items-center gap-1 mb-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-[var(--text-tertiary)]">
                    <circle cx="12" cy="7" r="4" />
                    <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
                  </svg>
                  <span className="text-[10px] font-medium text-[var(--text-secondary)]">
                    Your action
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
                  {stage.humanAction}
                </p>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
