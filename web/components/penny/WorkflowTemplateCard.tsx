"use client";

import { useState } from "react";
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
}

export default function WorkflowTemplateCard({ template }: WorkflowTemplateCardProps) {
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const stages = template.defaultBoard.stages;

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-3.5 space-y-2.5">
      {/* Header row: label + badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {template.label}
        </span>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full text-white font-medium"
          style={{ backgroundColor: ITEM_TYPE_COLORS[template.itemType] || "#555" }}
        >
          {ITEM_TYPE_LABELS[template.itemType] || template.itemType}
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)] font-mono ml-auto">
          {template.id}
        </span>
      </div>

      {/* Description */}
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2">
        {template.description}
      </p>

      {/* Stage pipeline — clickable */}
      <div className="flex flex-wrap gap-1.5 items-center">
        {stages.map((s, i) => {
          const isExpanded = expandedStage === s.key;
          return (
            <div key={s.key} className="flex items-center gap-1">
              <button
                onClick={() => setExpandedStage(isExpanded ? null : s.key)}
                className="text-[10px] px-2 py-0.5 rounded-full text-white font-medium transition-opacity hover:opacity-80 flex items-center gap-0.5"
                style={{
                  backgroundColor: s.color,
                  outline: isExpanded ? "2px solid var(--text-primary)" : "none",
                  outlineOffset: "1px",
                }}
                title={s.instructions}
              >
                {s.requiresHuman && (
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="white" stroke="none">
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
          <div className="rounded bg-[var(--bg-primary)] border border-[var(--border-color)] p-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: stage.color }}
              />
              <span className="text-[11px] font-semibold text-[var(--text-primary)]">
                {stage.label}
              </span>
              {stage.requiresHuman && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold uppercase">
                  Human Required
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
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="7" r="4" />
                    <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
                  </svg>
                  <span className="text-[10px] font-semibold text-amber-400">
                    Your action:
                  </span>
                </div>
                <p className="text-[11px] text-amber-300/80 leading-relaxed">
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
