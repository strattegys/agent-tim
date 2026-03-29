"use client";

import type { AgentConfig } from "@/lib/agent-frontend";
import { AGENT_CATEGORIES } from "@/lib/agent-frontend";
import { SIDEBAR_HEADER_TITLE } from "@/lib/app-brand";
import { agentHasUserWorkItem } from "@/lib/agent-work-badges";
import { WorkBellIcon } from "@/components/icons/WorkBellIcon";
import AgentAvatar from "./AgentAvatar";

const TEAM_CATEGORIES = AGENT_CATEGORIES.filter((c) => c !== "Toys");

interface AgentSidebarProps {
  agents: AgentConfig[];
  activeAgent: string;
  onSelect: (id: string) => void;
  unreadCounts?: Record<string, number>;
  pendingTaskCount?: number;
  testingTaskCount?: number;
  timMessagingTaskCount?: number;
  ghostContentTaskCount?: number;
}

export default function AgentSidebar({
  agents,
  activeAgent,
  onSelect,
  unreadCounts = {},
  pendingTaskCount = 0,
  testingTaskCount = 0,
  timMessagingTaskCount = 0,
  ghostContentTaskCount = 0,
}: AgentSidebarProps) {
  const workBadges = {
    pendingTaskCount,
    testingTaskCount,
    timMessagingTaskCount,
    ghostContentTaskCount,
  };
  return (
    <div className="w-[200px] min-w-[200px] border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-secondary)]">
      <div className="h-11 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3.5">
        <p
          className="text-xs font-medium text-[var(--text-tertiary)] leading-tight uppercase tracking-wide"
          title={SIDEBAR_HEADER_TITLE}
        >
          {SIDEBAR_HEADER_TITLE}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {TEAM_CATEGORIES.map((category) => {
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
                      <AgentAvatar
                        agentId={agent.id}
                        name={agent.name}
                        color={agent.color}
                        src={agent.avatar}
                      />
                      {unread > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-[var(--accent-orange)] text-white text-[10px] font-bold flex items-center justify-center px-1">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <div className="flex min-w-0 w-full items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                          <div
                            className={`min-w-0 truncate text-sm font-medium ${unread > 0 ? "text-white" : "text-[var(--text-primary)]"}`}
                          >
                            {agent.name}
                          </div>
                          <span
                            className="shrink-0 flex w-[14px] items-center justify-center"
                            title={
                              agentHasUserWorkItem(agent.id, workBadges)
                                ? "Work waiting for you"
                                : "No items waiting for you"
                            }
                          >
                            <span
                              className={
                                agentHasUserWorkItem(agent.id, workBadges)
                                  ? "text-[var(--accent-orange)]"
                                  : "text-[var(--accent-green)]"
                              }
                              aria-label={
                                agentHasUserWorkItem(agent.id, workBadges)
                                  ? "Work waiting for you"
                                  : undefined
                              }
                              aria-hidden={!agentHasUserWorkItem(agent.id, workBadges)}
                            >
                              <WorkBellIcon size={11} stroke="currentColor" />
                            </span>
                          </span>
                        </div>
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] truncate">{agent.role}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {/* Logout */}
      <div className="shrink-0 border-t border-[var(--border-color)] p-2">
        <button
          onClick={() => { window.location.href = "/api/auth/logout"; }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-colors text-xs"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Logout
        </button>
      </div>
    </div>
  );
}
