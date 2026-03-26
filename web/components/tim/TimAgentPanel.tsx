"use client";

import type { TimWorkQueueSelection } from "@/lib/tim-work-context";
import KanbanInlinePanel from "@/components/kanban/KanbanInlinePanel";
import TimMessagesPanel from "./TimMessagesPanel";

export type TimWorkTab = "messages" | "kanban";

interface TimAgentPanelProps {
  tab: TimWorkTab;
  onTab: (t: TimWorkTab) => void;
  /** Open items in Tim’s work queue — same source as sidebar / status rail */
  messageQueueCount?: number;
  onTimWorkSelectionChange?: (selection: TimWorkQueueSelection | null) => void;
}

/**
 * Sub-tabs: Work queue | Pipeline.
 */
export default function TimAgentPanel({
  tab,
  onTab,
  messageQueueCount = 0,
  onTimWorkSelectionChange,
}: TimAgentPanelProps) {
  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
        {(["messages", "kanban"] as const).map((key) => {
          const label = key === "messages" ? "Work queue" : "Pipeline";
          const isActive = tab === key;
          const showQ =
            key === "messages" && messageQueueCount > 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onTab(key)}
              className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors inline-flex items-center gap-1.5 ${
                isActive
                  ? "font-semibold text-[var(--text-primary)]"
                  : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span>{label}</span>
              {showQ && (
                <span
                  className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#F59E0B] text-[10px] font-bold text-black tabular-nums flex items-center justify-center"
                  title={`${messageQueueCount} open in work queue`}
                >
                  {messageQueueCount > 99 ? "99+" : messageQueueCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "messages" ? (
          <TimMessagesPanel embedded onWorkSelectionChange={onTimWorkSelectionChange} />
        ) : (
          <KanbanInlinePanel
            onClose={() => onTab("messages")}
            agentId="tim"
            readOnly
            embeddedInTimTabs
          />
        )}
      </div>
    </div>
  );
}
