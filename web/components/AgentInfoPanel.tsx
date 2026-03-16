"use client";

import type { AgentConfig } from "@/app/chat/page";

interface AgentInfoPanelProps {
  agent: AgentConfig;
}

export default function AgentInfoPanel({ agent }: AgentInfoPanelProps) {
  return (
    <div className="w-[200px] min-w-[200px] border-l border-[var(--border-color)] bg-[var(--bg-secondary)] flex flex-col overflow-y-auto">
      <div className="flex flex-col items-center gap-3 p-4 pt-5">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden"
          style={{ background: agent.color }}
        >
          {agent.avatar ? (
            <img
              src={agent.avatar}
              alt={agent.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-2xl font-medium text-white">
              {agent.name[0]}
            </span>
          )}
        </div>
        <div className="text-center">
          <div className="font-medium">{agent.name}</div>
          <div className="text-xs text-[var(--text-secondary)]">
            {agent.role}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: agent.online ? "#1D9E75" : "#555" }}
          />
          <span className="text-xs text-[var(--text-secondary)]">
            {agent.online ? "Online" : "Offline"}
          </span>
        </div>
      </div>

      {agent.connections.length > 0 && (
        <div className="px-4 pb-4 border-t border-[var(--border-color)] pt-3">
          <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">
            Connections
          </div>
          <div className="flex flex-col gap-2">
            {agent.connections.map((c) => (
              <div key={c.label} className="flex justify-between text-xs">
                <span className="text-[var(--text-secondary)]">{c.label}</span>
                <span
                  style={{
                    color: c.connected ? "#1D9E75" : "#888",
                  }}
                >
                  {c.connected ? "Connected" : "Off"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 pb-4 border-t border-[var(--border-color)] pt-3">
        <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">
          Capabilities
        </div>
        <div className="flex flex-wrap gap-1">
          {agent.capabilities.map((cap) => (
            <span
              key={cap}
              className="text-[11px] px-2 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-secondary)]"
            >
              {cap}
            </span>
          ))}
        </div>
      </div>

      {agent.id === "tim" && (
        <div className="px-4 pb-4 border-t border-[var(--border-color)] pt-3">
          <div className="text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Send command
          </div>
          <div
            className="text-xs px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] font-mono"
            style={{ color: "#1D9E75" }}
          >
            &quot;send it now&quot;
          </div>
        </div>
      )}
    </div>
  );
}
