"use client";

import type { AgentConfig } from "@/lib/agent-frontend";
import { AGENT_CATEGORIES } from "@/lib/agent-frontend";
import { getAppBrandTitle, getAppHeadline } from "@/lib/app-brand";
import AgentAvatar from "./AgentAvatar";
import NotificationBell from "./NotificationBell";
import type { DashboardNotification } from "@/lib/dashboard-sync-types";

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
  sharedNotifications?: DashboardNotification[];
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
  sharedNotifications,
}: AgentSidebarProps) {
  const appTitle = getAppBrandTitle();
  const headline = getAppHeadline();
  return (
    <div className="w-[200px] min-w-[200px] border-r border-[var(--border-color)] flex flex-col bg-[var(--bg-secondary)]">
      <div className="shrink-0 px-2 py-2 border-b border-[var(--border-color)] min-w-0 relative">
        <div className="absolute top-2 right-2 z-10">
          <NotificationBell sharedNotifications={sharedNotifications} />
        </div>
        <p
          className="text-[10px] font-semibold text-[var(--text-primary)] leading-snug pr-7"
          title={headline}
        >
          {headline}
        </p>
        {appTitle !== headline && (
          <p
            className="text-[9px] text-[var(--text-secondary)] mt-1 truncate"
            title={appTitle}
          >
            {appTitle}
          </p>
        )}
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
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-sm font-medium ${unread > 0 ? "text-white" : "text-[var(--text-primary)]"}`}>
                          {agent.name}
                        </span>
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            background: !agent.online
                              ? "#555"
                              : (agent.id === "penny" && testingTaskCount > 0) ||
                                  (agent.id === "tim" && timMessagingTaskCount > 0) ||
                                  (agent.id === "ghost" && ghostContentTaskCount > 0)
                                ? "#F59E0B"
                                : "#1D9E75",
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
