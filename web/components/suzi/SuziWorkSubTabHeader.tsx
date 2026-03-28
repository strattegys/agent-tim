"use client";

import type { ReactNode } from "react";
import type { SuziWorkSubTab } from "@/lib/suzi-work-panel";
import { SUZI_WORK_TAB_HEADER_HINT } from "@/lib/suzi-work-panel";

const TAB_ORDER: SuziWorkSubTab[] = ["intake", "punchlist", "reminders", "notes"];

const TAB_LABEL: Record<SuziWorkSubTab, string> = {
  intake: "Intake",
  punchlist: "Punch List",
  reminders: "Reminders",
  notes: "Notes",
};

/**
 * Shared Suzi work-panel sub-tab row: tabs (left), green command hint (center-right),
 * optional human fallback control (e.g. Intake add) after the hint.
 */
export default function SuziWorkSubTabHeader({
  subTab,
  onSubTabChange,
  fallbackAction,
}: {
  subTab: SuziWorkSubTab;
  onSubTabChange: (tab: SuziWorkSubTab) => void;
  /** Only when the active tab already exposes that action elsewhere (e.g. modal add). */
  fallbackAction?: ReactNode;
}) {
  const hint = SUZI_WORK_TAB_HEADER_HINT[subTab];

  return (
    <div className="min-h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center gap-2 px-2 sm:px-3 py-1.5">
      <div className="flex items-center gap-0.5 sm:gap-1 flex-wrap min-w-0 flex-1">
        {TAB_ORDER.map((tab) => {
          const isActive = subTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onSubTabChange(tab)}
              className={`text-sm px-2 sm:px-2.5 py-1 rounded cursor-pointer transition-colors ${
                isActive
                  ? "font-semibold text-[var(--text-primary)]"
                  : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {TAB_LABEL[tab]}
            </button>
          );
        })}
      </div>
      <div
        className="shrink-0 max-w-[min(50vw,16rem)] sm:max-w-[18rem] rounded-md border border-[var(--border-color)]/70 bg-[var(--bg-primary)]/60 px-2 py-1"
        role="note"
        aria-label={hint}
      >
        <p className="text-[10px] sm:text-[11px] font-medium text-[var(--accent-green)] leading-tight">
          {hint}
        </p>
      </div>
      {fallbackAction}
    </div>
  );
}
