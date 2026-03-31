"use client";

import KanbanInlinePanel from "@/components/kanban/KanbanInlinePanel";

interface MarniWorkPanelProps {
  onClose: () => void;
}

/**
 * Marni’s work panel: distribution Kanban only. Knowledge base: header book icon.
 */
export default function MarniWorkPanel({ onClose }: MarniWorkPanelProps) {
  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      <div className="min-h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-2 sm:px-3 py-1.5">
        <h2 className="text-xs font-semibold text-[var(--text-primary)]">Work queue</h2>
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <KanbanInlinePanel onClose={onClose} agentId="marni" />
      </div>
    </div>
  );
}
