"use client";

import type { WorkflowTypeSpec } from "@/lib/workflow-types";

const ITEM_TYPE_LABELS: Record<string, string> = {
  person: "People",
  content: "Content",
};

const ITEM_TYPE_COLORS: Record<string, string> = {
  person: "#2563EB",
  content: "#9B59B6",
};

interface TemplateCardProps {
  template: WorkflowTypeSpec;
}

export default function TemplateCard({ template }: TemplateCardProps) {
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
      </div>

      {/* Description */}
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2">
        {template.description}
      </p>

      {/* Stage pipeline */}
      <div className="flex flex-wrap gap-1.5 items-center">
        {stages.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1">
            <span
              className="text-[10px] px-2 py-0.5 rounded-full text-white font-medium"
              style={{ backgroundColor: s.color }}
            >
              {s.label}
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
        ))}
      </div>
    </div>
  );
}
