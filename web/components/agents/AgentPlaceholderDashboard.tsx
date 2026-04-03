"use client";

import type { AgentConfig } from "@/lib/agent-frontend";

/**
 * Reserved shell for agents until a real dashboard ships.
 * Friday keeps `FridayDashboardPanel`; Suzi’s overview lives under Work (reminders) › Dashboard.
 * Penny / Scout / King embed this as the first tab inside their workspace panel.
 */
export default function AgentPlaceholderDashboard({
  agent,
  onClose,
  closeLabel = "Back to agent info",
}: {
  agent: AgentConfig;
  onClose: () => void;
  /** When embedded in a multi-tab work panel, e.g. “Continue to Cost Usage”. */
  closeLabel?: string;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--bg-primary)] px-4 py-6">
      <div className="max-w-md mx-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/40 p-6 text-center space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
          Dashboard
        </p>
        <p className="text-sm font-medium text-[var(--text-primary)]" style={{ color: agent.color }}>
          {agent.name}
        </p>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          This space is reserved for a future overview—metrics, shortcuts, and status for this agent.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-medium text-[#5B8DEF] hover:underline pt-1"
        >
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
