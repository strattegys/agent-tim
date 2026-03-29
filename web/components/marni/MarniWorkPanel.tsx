"use client";

import { useState, useEffect } from "react";
import KanbanInlinePanel from "@/components/kanban/KanbanInlinePanel";
import MarniKnowledgePanel, { type MarniKnowledgeFocus } from "./MarniKnowledgePanel";
import { HUMAN_MANUAL_ACTION_BTN_CLASS } from "@/lib/suzi-work-panel";
import { MARNI_KNOWLEDGE_TAB_HEADER_HINT } from "@/lib/marni-work-panel";

export type MarniWorkPanelTab = "queue" | "knowledge";

interface MarniWorkPanelProps {
  onClose: () => void;
  /** Chat UI: active tab for ephemeral agent context. */
  onWorkTabChange?: (tab: MarniWorkPanelTab) => void;
  /** Knowledge tab: selected topic for Marni chat context (cleared when leaving Knowledge). */
  onKnowledgeFocusChange?: (focus: MarniKnowledgeFocus | null) => void;
}

/**
 * Marni’s work panel: content-distribution pipeline (inline Kanban) and Knowledge Base, like Tim’s multi-tab work panel.
 */
export default function MarniWorkPanel({
  onClose,
  onWorkTabChange,
  onKnowledgeFocusChange,
}: MarniWorkPanelProps) {
  const [tab, setTab] = useState<MarniWorkPanelTab>("queue");
  const [knowledgeAddTopicOpen, setKnowledgeAddTopicOpen] = useState(false);

  useEffect(() => {
    onWorkTabChange?.(tab);
  }, [tab, onWorkTabChange]);

  useEffect(() => {
    if (tab !== "knowledge") onKnowledgeFocusChange?.(null);
  }, [tab, onKnowledgeFocusChange]);

  useEffect(() => {
    if (tab !== "knowledge") setKnowledgeAddTopicOpen(false);
  }, [tab]);

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      <div className="min-h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center gap-2 px-2 sm:px-3 py-1.5 overflow-x-auto">
        <div className="flex items-center gap-0.5 sm:gap-1 flex-wrap min-w-0 flex-1">
          {(["queue", "knowledge"] as const).map((key) => {
            const label = key === "queue" ? "Work Queue" : "Knowledge Base";
            const isActive = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
                  isActive
                    ? "font-semibold text-[var(--text-primary)]"
                    : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
        {tab === "knowledge" && (
          <>
            <div
              className="shrink-0 rounded-md border border-[var(--border-color)]/35 bg-[var(--bg-primary)]/25 px-2 py-1"
              role="note"
              aria-label={MARNI_KNOWLEDGE_TAB_HEADER_HINT}
            >
              <p className="text-[10px] sm:text-[11px] font-normal text-[var(--text-tertiary)]/90 leading-none whitespace-nowrap">
                {MARNI_KNOWLEDGE_TAB_HEADER_HINT}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setKnowledgeAddTopicOpen(true)}
              title="Add a research topic"
              className={HUMAN_MANUAL_ACTION_BTN_CLASS}
            >
              Add topic
            </button>
          </>
        )}
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "queue" ? (
          <KanbanInlinePanel onClose={onClose} agentId="marni" />
        ) : (
          <MarniKnowledgePanel
            embedded
            onClose={onClose}
            onKnowledgeFocusChange={onKnowledgeFocusChange}
            addTopicOpen={knowledgeAddTopicOpen}
            onAddTopicOpenChange={setKnowledgeAddTopicOpen}
          />
        )}
      </div>
    </div>
  );
}
