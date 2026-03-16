"use client";

import type { AgentConfig } from "@/app/chat/page";

interface AgentSidebarProps {
  agents: AgentConfig[];
  activeAgent: string;
  onSelect: (id: string) => void;
}

export default function AgentSidebar({
  agents,
  activeAgent,
  onSelect,
}: AgentSidebarProps) {
  return (
    <div className="w-[200px] min-w-[200px] border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-secondary)]">
      <div className="px-4 py-3 text-sm font-medium border-b border-[var(--border-color)]">
        Agents
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
              activeAgent === agent.id
                ? "bg-[var(--bg-primary)]"
                : "hover:bg-[var(--bg-primary)]"
            }`}
          >
            <div
              className="w-9 h-9 min-w-[36px] min-h-[36px] rounded-full flex items-center justify-center overflow-hidden shrink-0"
              style={{ background: agent.color }}
            >
              {agent.avatar ? (
                <img
                  src={agent.avatar}
                  alt={agent.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-sm font-medium text-white">
                  {agent.name[0]}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {agent.name}
                </span>
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    background: agent.online ? "#1D9E75" : "#555",
                  }}
                />
              </div>
              <div className="text-xs text-[var(--text-secondary)] truncate">
                {agent.role}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
