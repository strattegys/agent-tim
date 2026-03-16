"use client";

import { useState, useEffect } from "react";
import type { AgentConfig } from "@/app/chat/page";
import SystemPromptEditor from "@/components/SystemPromptEditor";

interface Routine {
  name: string;
  schedule: string;
  description: string;
  logFile?: string;
}

interface BackendConfig {
  id: string;
  sessionFile: string;
  systemPromptFile: string;
  tools: string[];
  routines: Routine[];
}

interface AgentInfoPanelProps {
  agent: AgentConfig;
}

export default function AgentInfoPanel({ agent }: AgentInfoPanelProps) {
  const [showInspect, setShowInspect] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [backendConfig, setBackendConfig] = useState<BackendConfig | null>(null);
  const [approvalPhrases, setApprovalPhrases] = useState<string[]>([]);

  useEffect(() => {
    setPromptText("");
    setBackendConfig(null);
    setApprovalPhrases([]);
    // Load approval phrases for sidebar display
    fetch(`/api/agent-config?agent=${agent.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.approvalPhrases) setApprovalPhrases(data.approvalPhrases);
      })
      .catch(() => {});
  }, [agent.id]);

  const loadInspectData = () => {
    fetch(`/api/system-prompt?agent=${agent.id}`)
      .then((res) => res.json())
      .then((data) => { if (data.prompt) setPromptText(data.prompt); })
      .catch(() => {});
    fetch(`/api/agent-config?agent=${agent.id}`)
      .then((res) => res.json())
      .then((data) => { if (data.config) setBackendConfig(data.config); })
      .catch(() => {});
  };

  const handleInspect = () => {
    loadInspectData();
    setShowInspect(true);
  };

  return (
    <>
      <div className="w-[200px] min-w-[200px] border-l border-[var(--border-color)] bg-[var(--bg-secondary)] flex flex-col overflow-y-auto">
        <div className="flex flex-col items-center gap-3 p-4 pt-5">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden"
            style={{ background: agent.color }}
          >
            {agent.avatar ? (
              <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-medium text-white">{agent.name[0]}</span>
            )}
          </div>
          <div className="text-center">
            <div className="font-medium">{agent.name}</div>
            <div className="text-xs text-[var(--text-secondary)]">{agent.role}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: agent.online ? "#1D9E75" : "#555" }} />
            <span className="text-xs text-[var(--text-secondary)]">{agent.online ? "Online" : "Offline"}</span>
          </div>
          {/* Inspect button — right below status */}
          <button
            onClick={handleInspect}
            className="text-[11px] px-3 py-1 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] flex items-center gap-1.5"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            Inspect
          </button>
        </div>

        {agent.connections.length > 0 && (
          <div className="px-4 pb-4 border-t border-[var(--border-color)] pt-3">
            <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">Connections</div>
            <div className="flex flex-col gap-2">
              {agent.connections.map((c) => (
                <div key={c.label} className="flex justify-between text-xs">
                  <span className="text-[var(--text-secondary)]">{c.label}</span>
                  <span style={{ color: c.connected ? "#1D9E75" : "#888" }}>{c.connected ? "Connected" : "Off"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="px-4 pb-4 border-t border-[var(--border-color)] pt-3">
          <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">Capabilities</div>
          <div className="flex flex-wrap gap-1">
            {agent.capabilities.map((cap) => (
              <span key={cap} className="text-[11px] px-2 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-secondary)]">
                {cap}
              </span>
            ))}
          </div>
        </div>

        {approvalPhrases.length > 0 && (
          <div className="px-4 pb-4 border-t border-[var(--border-color)] pt-3">
            <div className="text-xs font-medium text-[var(--text-secondary)] mb-1.5">Approval commands</div>
            <div className="flex flex-col gap-1">
              {approvalPhrases.map((phrase) => (
                <div key={phrase} className="text-[11px] px-2 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] font-mono" style={{ color: "#1D9E75" }}>
                  &quot;{phrase}&quot;
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Inspect overlay */}
      {showInspect && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden" style={{ background: agent.color }}>
                  {agent.avatar ? (
                    <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-sm font-medium text-white">{agent.name[0]}</span>
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium">{agent.name} — Inspector</div>
                  <div className="text-[11px] text-[var(--text-secondary)]">{agent.role}</div>
                </div>
              </div>
              <button onClick={() => setShowInspect(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-lg px-2">
                &times;
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Frontend Config JSON */}
              <div>
                <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">Frontend Config</div>
                <pre className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)] text-[11px] font-mono text-[var(--accent-blue)] overflow-x-auto leading-relaxed">
{JSON.stringify({
  id: agent.id,
  name: agent.name,
  role: agent.role,
  color: agent.color,
  avatar: agent.avatar || null,
  online: agent.online,
  capabilities: agent.capabilities,
  connections: agent.connections,
}, null, 2)}
                </pre>
              </div>

              {/* Backend Config */}
              <div>
                <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">Backend Config</div>
                {backendConfig ? (
                  <div className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)] text-xs font-mono space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="text-[var(--text-tertiary)] shrink-0 w-24">Session:</span>
                      <span className="text-[var(--accent-green)] break-all">{backendConfig.sessionFile}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[var(--text-tertiary)] shrink-0 w-24">Prompt file:</span>
                      <span className="text-[var(--accent-green)] break-all">{backendConfig.systemPromptFile}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-[var(--text-tertiary)] shrink-0 w-24">Tools:</span>
                      <div className="flex flex-wrap gap-1">
                        {backendConfig.tools.map((t) => (
                          <span key={t} className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)]">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)] text-xs text-[var(--text-tertiary)]">
                    Loading...
                  </div>
                )}
              </div>

              {/* Connection Details */}
              <div>
                <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">Connections</div>
                <div className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)] text-xs font-mono space-y-1.5">
                  {agent.connections.map((c) => (
                    <div key={c.label} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: c.connected ? "#1D9E75" : "#888" }} />
                      <span className="text-[var(--text-primary)]">{c.label}</span>
                      <span className="text-[var(--text-tertiary)]">—</span>
                      <span style={{ color: c.connected ? "#1D9E75" : "#888" }}>
                        {c.connected ? "Connected" : "Disconnected"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Capabilities */}
              <div>
                <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">Capabilities</div>
                <div className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)] flex flex-wrap gap-1.5">
                  {agent.capabilities.map((cap) => (
                    <span key={cap} className="text-[11px] px-2 py-1 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)]">
                      {cap}
                    </span>
                  ))}
                </div>
              </div>

              {/* Routines */}
              <div>
                <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">Routines / Cron Jobs</div>
                {backendConfig?.routines && backendConfig.routines.length > 0 ? (
                  <div className="space-y-2">
                    {backendConfig.routines.map((r) => (
                      <div key={r.name} className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)]">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-[var(--text-primary)]">{r.name}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--accent-blue)]">{r.schedule}</span>
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)] mb-1">{r.description}</div>
                        {r.logFile && (
                          <div className="text-[10px] font-mono text-[var(--text-tertiary)]">
                            Log: {r.logFile}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)] text-xs text-[var(--text-tertiary)]">
                    No scheduled routines
                  </div>
                )}
              </div>

              {/* System Prompt */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-[var(--text-secondary)]">System Prompt</div>
                  <button
                    onClick={() => { setShowInspect(false); setShowPromptEditor(true); }}
                    className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-green)] text-white hover:brightness-110"
                  >
                    Edit
                  </button>
                </div>
                <div className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)] text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">
                  {promptText || "Loading..."}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* System Prompt Editor */}
      {showPromptEditor && (
        <SystemPromptEditor
          agentId={agent.id}
          agentName={agent.name}
          onClose={() => {
            setShowPromptEditor(false);
            fetch(`/api/system-prompt?agent=${agent.id}`)
              .then((res) => res.json())
              .then((data) => { if (data.prompt) setPromptText(data.prompt); })
              .catch(() => {});
          }}
        />
      )}
    </>
  );
}
