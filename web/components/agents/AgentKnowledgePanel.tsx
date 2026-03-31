"use client";

import { useState } from "react";
import MarniKnowledgePanel, { type MarniKnowledgeFocus } from "@/components/marni/MarniKnowledgePanel";
import { HUMAN_MANUAL_ACTION_BTN_CLASS } from "@/lib/suzi-work-panel";
import {
  MARNI_KNOWLEDGE_TAB_HEADER_HINT,
  TIM_KNOWLEDGE_BOOK_HINT,
} from "@/lib/marni-work-panel";
import { getFrontendAgents } from "@/lib/agent-frontend";

function BookHeader({ title }: { title: string }) {
  return (
    <div className="min-h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 py-2">
      <h2 className="text-xs font-semibold text-[var(--text-primary)] truncate">{title}</h2>
    </div>
  );
}

function AgentKnowledgeEmpty({
  agentName,
  agentId,
  onClose,
}: {
  agentName: string;
  agentId: string;
  onClose: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-primary)]">
      <BookHeader title={`${agentName} — Knowledge base`} />
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-[var(--text-secondary)] max-w-sm">
          No knowledge base UI is wired for{" "}
          <span className="font-medium text-[var(--text-primary)]">{agentName}</span> yet. Marni and Tim use Knowledge
          Studio; others will follow.
        </p>
        <p className="text-[10px] text-[var(--text-tertiary)] font-mono">agentId: {agentId}</p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export interface AgentKnowledgePanelProps {
  agentId: string;
  onClose: () => void;
  onMarniKnowledgeFocusChange?: (focus: MarniKnowledgeFocus | null) => void;
  onTimKnowledgeFocusChange?: (focus: MarniKnowledgeFocus | null) => void;
}

/** Per-agent knowledge — opened from the header book icon (next to Agent info). */
export default function AgentKnowledgePanel({
  agentId,
  onClose,
  onMarniKnowledgeFocusChange,
  onTimKnowledgeFocusChange,
}: AgentKnowledgePanelProps) {
  const [marniAddTopicOpen, setMarniAddTopicOpen] = useState(false);
  const [timAddTopicOpen, setTimAddTopicOpen] = useState(false);
  const agents = getFrontendAgents();
  const meta = agents.find((a) => a.id === agentId);
  const agentName = meta?.name ?? agentId;

  if (agentId === "marni") {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-primary)] overflow-hidden">
        <div className="min-h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center gap-2 px-2 sm:px-3 py-1.5">
          <h2 className="text-xs font-semibold text-[var(--text-primary)] truncate flex-1 min-w-0">
            Marni — Knowledge base
          </h2>
          <div
            className="shrink-0 rounded-md border border-[var(--border-color)]/35 bg-[var(--bg-primary)]/25 px-2 py-1 hidden sm:block max-w-[min(200px,40vw)]"
            role="note"
            aria-label={MARNI_KNOWLEDGE_TAB_HEADER_HINT}
          >
            <p className="text-[10px] sm:text-[11px] font-normal text-[var(--text-tertiary)]/90 leading-tight line-clamp-2">
              {MARNI_KNOWLEDGE_TAB_HEADER_HINT}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMarniAddTopicOpen(true)}
            title="Add a research topic"
            className={HUMAN_MANUAL_ACTION_BTN_CLASS}
          >
            Add topic
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <MarniKnowledgePanel
            embedded
            kbAgentId="marni"
            onClose={onClose}
            onKnowledgeFocusChange={onMarniKnowledgeFocusChange}
            addTopicOpen={marniAddTopicOpen}
            onAddTopicOpenChange={setMarniAddTopicOpen}
          />
        </div>
      </div>
    );
  }

  if (agentId === "tim") {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-primary)] overflow-hidden">
        <div className="min-h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center gap-2 px-2 sm:px-3 py-1.5">
          <h2 className="text-xs font-semibold text-[var(--text-primary)] truncate flex-1 min-w-0">
            Tim — Knowledge base
          </h2>
          <div
            className="shrink-0 rounded-md border border-[var(--border-color)]/35 bg-[var(--bg-primary)]/25 px-2 py-1 hidden sm:block max-w-[min(200px,40vw)]"
            role="note"
            aria-label={TIM_KNOWLEDGE_BOOK_HINT}
          >
            <p className="text-[10px] sm:text-[11px] font-normal text-[var(--text-tertiary)]/90 leading-tight line-clamp-2">
              {TIM_KNOWLEDGE_BOOK_HINT}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTimAddTopicOpen(true)}
            title="Add a research topic"
            className={HUMAN_MANUAL_ACTION_BTN_CLASS}
          >
            Add topic
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <MarniKnowledgePanel
            embedded
            kbAgentId="tim"
            onClose={onClose}
            onKnowledgeFocusChange={onTimKnowledgeFocusChange}
            addTopicOpen={timAddTopicOpen}
            onAddTopicOpenChange={setTimAddTopicOpen}
          />
        </div>
      </div>
    );
  }

  return <AgentKnowledgeEmpty agentName={agentName} agentId={agentId} onClose={onClose} />;
}
