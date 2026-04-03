"use client";

import { useState } from "react";
import type { TimWorkQueueSelection } from "@/lib/tim-work-context";
import type { AgentConfig } from "@/lib/agent-frontend";
import TimDashboardPanel from "./TimDashboardPanel";
import TimCrmPanel from "./TimCrmPanel";
import TimMessagesPanel from "./TimMessagesPanel";

export type TimWorkPanelTab = "dashboard" | "messaging" | "crm";

interface TimAgentPanelProps {
  agent: AgentConfig;
  /** Active workflow rows + pending follow-up + inbound receipt rows (dashboard unified count). */
  unifiedMessagingCount?: number;
  onTimWorkSelectionChange?: (selection: TimWorkQueueSelection | null) => void;
}

/**
 * Tim’s work panel: dashboard, work queue (messaging), CRM.
 */
export default function TimAgentPanel({
  agent,
  unifiedMessagingCount = 0,
  onTimWorkSelectionChange,
}: TimAgentPanelProps) {
  const [tab, setTab] = useState<TimWorkPanelTab>("messaging");

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-2 gap-0.5">
        {(["dashboard", "messaging", "crm"] as const).map((key) => {
          const label =
            key === "dashboard" ? "Dashboard" : key === "messaging" ? "Work Queue" : "CRM";
          const isActive = tab === key;
          const count = key === "messaging" ? unifiedMessagingCount : 0;
          const showBadge = count > 0 && key === "messaging";
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors inline-flex items-center gap-1.5 max-sm:max-w-[32%] ${
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
        ) : tab === "dashboard" ? (
          <TimDashboardPanel />
        ) : (
          <TimMessagesPanel embedded onWorkSelectionChange={onTimWorkSelectionChange} />
        )}
      </div>
    </div>
  );
}
