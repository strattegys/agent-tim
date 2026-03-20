"use client";

import type { AgentConfig } from "@/app/chat/page";
import { AGENT_CATEGORIES } from "@/app/chat/page";
import NotificationBell from "./NotificationBell";

interface AgentSidebarProps {
  agents: AgentConfig[];
  activeAgent: string;
  onSelect: (id: string) => void;
  unreadCounts?: Record<string, number>;
}

export default function AgentSidebar({
  agents,
  activeAgent,
  onSelect,
  unreadCounts = {},
}: AgentSidebarProps) {
  return (
    <div className="w-[200px] min-w-[200px] border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-secondary)]">
      <div className="h-11 shrink-0 px-4 text-sm font-medium border-b border-[var(--border-color)] flex items-center">
        <span>Agents</span>
        <div className="ml-auto">
          <NotificationBell />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {AGENT_CATEGORIES.map((category) => {
          const categoryAgents = agents.filter((a) => a.category === category);
          if (categoryAgents.length === 0) return null;
          return (
            <div key={category}>
              <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                {category}
              </div>
              {categoryAgents.map((agent) => {
                const unread = unreadCounts[agent.id] || 0;
                return (
                  <button
                    key={agent.id}
                    onClick={() => onSelect(agent.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      activeAgent === agent.id
                        ? "bg-[var(--bg-primary)] border border-[#4a9eca]"
                        : "hover:bg-[var(--bg-primary)] border border-transparent"
                    }`}
                  >
                    <div className="relative shrink-0">
                      <div
                        className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center overflow-hidden"
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
                      {unread > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-[var(--accent-orange)] text-white text-[10px] font-bold flex items-center justify-center px-1">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-sm font-medium ${unread > 0 ? "text-white" : "text-[var(--text-primary)]"}`}>
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
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
