"use client";

import { useState } from "react";
import type { TimWorkQueueSelection } from "@/lib/tim-work-context";
import TimCrmPanel from "./TimCrmPanel";
import TimMessagesPanel from "./TimMessagesPanel";

export type TimWorkPanelTab = "active" | "pending" | "crm";

interface TimAgentPanelProps {
  /** Actionable items (excludes waiting follow-up) — same as human-tasks `count` for Tim */
  messageQueueCount?: number;
  /** Warm-outreach MESSAGED / waiting follow-up rows */
  pendingQueueCount?: number;
  onTimWorkSelectionChange?: (selection: TimWorkQueueSelection | null) => void;
}

/**
 * Tim’s work panel: Active / Pending work queues plus a **CRM** directory tab (see `AGENT_UI_ARCHITECTURE.md`).
 */
export default function TimAgentPanel({
  messageQueueCount = 0,
  pendingQueueCount = 0,
  onTimWorkSelectionChange,
}: TimAgentPanelProps) {
  const [tab, setTab] = useState<TimWorkPanelTab>("active");

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-2 gap-0.5">
        {(["active", "pending", "crm"] as const).map((key) => {
          const label =
            key === "active" ? "Active Work Queue" : key === "pending" ? "Pending Work Queue" : "CRM";
          const isActive = tab === key;
          const count = key === "active" ? messageQueueCount : key === "pending" ? pendingQueueCount : 0;
          const showBadge = count > 0 && key !== "crm";
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors inline-flex items-center gap-1.5 max-sm:max-w-[48%] ${
                isActive
                  ? "font-semibold text-[var(--text-primary)]"
                  : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span className="truncate">{label}</span>
              {showBadge ? (
                <span
                  className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-medium tabular-nums flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-color)]"
                  title={`${count} item${count !== 1 ? "s" : ""}`}
                >
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "crm" ? (
          <TimCrmPanel />
        ) : (
          <TimMessagesPanel
            embedded
            queueTab={tab}
            onWorkSelectionChange={onTimWorkSelectionChange}
          />
        )}
      </div>
    </div>
  );
}
