"use client";

import { useState, useEffect, useRef } from "react";
import type { AgentConfig } from "@/app/chat/page";


interface Routine {
  name: string;
  schedule: string;
  description: string;
  logFile?: string;
}

interface CronJobStatus {
  id: string;
  name: string;
  schedule: string;
  description: string;
  logFile: string | null;
  agentId: string;
  enabled: boolean;
  lastRun: string | null;
  lastResult: string | null;
}

interface BackendConfig {
  id: string;
  sessionFile: string;
  systemPromptFile: string;
  memoryDir?: string;
  tools: string[];
  routines: Routine[];
}

interface AgentInfoPanelProps {
  agent: AgentConfig;
  onAvatarChange?: (agentId: string, newUrl: string) => void;
}

export default function AgentInfoPanel({ agent, onAvatarChange }: AgentInfoPanelProps) {
  const [promptText, setPromptText] = useState("");
  const [backendConfig, setBackendConfig] = useState<BackendConfig | null>(null);
  const [approvalPhrases, setApprovalPhrases] = useState<string[]>([]);
  const [cronJobs, setCronJobs] = useState<CronJobStatus[]>([]);
  const [agentSummary, setAgentSummary] = useState("");
  const [promptCollapsed, setPromptCollapsed] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load all dashboard data on agent change
  useEffect(() => {
    setPromptText("");
    setBackendConfig(null);
    setApprovalPhrases([]);
    setCronJobs([]);
    setAgentSummary("");
    setPromptCollapsed(true);

    if (agent.id === "tim") {
      fetch(`/api/agent-summary?agent=${agent.id}`)
        .then((res) => res.json())
        .then((data) => { if (data.summary) setAgentSummary(data.summary); })
        .catch(() => {});
    }

    fetch(`/api/agent-config?agent=${agent.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.approvalPhrases) setApprovalPhrases(data.approvalPhrases);
        if (data.config) setBackendConfig(data.config);
      })
      .catch(() => {});

    fetch(`/api/system-prompt?agent=${agent.id}`)
      .then((res) => res.json())
      .then((data) => { if (data.prompt) setPromptText(data.prompt); })
      .catch(() => {});

    fetch(`/api/cron-status?agent=${agent.id}`)
      .then((res) => res.json())
      .then((data) => { if (data.jobs) setCronJobs(data.jobs); })
      .catch(() => {});
  }, [agent.id]);

  const heartbeatJob = cronJobs.find((j) => j.id === `heartbeat-${agent.id}`);
  const heartbeatChecks =
    agent.id === "tim"
      ? [
          { name: "LinkedIn Alerts", desc: "Flags inbound messages with no user response in last 2 hours", priority: "high" },
          { name: "Memory Reminders", desc: "Scans memory for follow-ups, todos, and deadlines due today", priority: "medium" },
          { name: "Scheduled Messages", desc: "Detects failed or overdue scheduled LinkedIn messages", priority: "high" },
          { name: "Campaign Health", desc: "Checks for empty or inactive campaigns in CRM", priority: "low" },
        ]
      : [];

  const compressImage = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX = 512;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error("Compression failed")),
          "image/png",
          0.85
        );
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = URL.createObjectURL(file);
    });
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      alert("Image must be under 25MB");
      return;
    }

    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append("file", new File([compressed], `${agent.id}-avatar.png`, { type: "image/png" }));
      form.append("agentId", agent.id);
      const res = await fetch("/api/agent-avatar", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        alert(`Upload failed: ${err.error || "Unknown error"}`);
        return;
      }
      const data = await res.json();
      if (data.avatarUrl && onAvatarChange) {
        onAvatarChange(agent.id, data.avatarUrl);
      }
    } catch (err) {
      alert(`Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <div className="flex-1 border-l border-[var(--border-color)] bg-[var(--bg-secondary)] flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="shrink-0 border-b border-[var(--border-color)] px-5 py-3 flex items-center gap-3">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center overflow-hidden shrink-0 relative group cursor-pointer"
            style={{ background: agent.color }}
            onClick={() => fileInputRef.current?.click()}
          >
            {agent.avatar ? (
              <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-medium text-white">{agent.name[0]}</span>
            )}
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
              {uploading ? (
                <svg className="w-6 h-6 text-white animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-lg">{agent.name}</div>
            <div className="text-sm text-[var(--text-secondary)]">{agent.role}</div>
          </div>
          <div className="flex items-center gap-1.5 ml-3">
            <span className="w-2 h-2 rounded-full" style={{ background: agent.online ? "#1D9E75" : "#555" }} />
            <span className="text-xs text-[var(--text-secondary)]">{agent.online ? "Online" : "Offline"}</span>
          </div>
        </div>

        {/* Dashboard content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Agent Summary */}
          {agentSummary && (
            <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {agentSummary}
            </div>
          )}

          {/* Capabilities (consolidated) */}
          <div className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)]">
            <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">Capabilities</div>
            {/* Connections with status */}
            <div className="space-y-1.5 mb-2">
              {agent.connections.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.connected ? "#1D9E75" : "#888" }} />
                  <span className="text-[var(--text-primary)]">{c.label}</span>
                  <span className="ml-auto text-[11px]" style={{ color: c.connected ? "#1D9E75" : "#888" }}>
                    {c.connected ? "Connected" : "Off"}
                  </span>
                </div>
              ))}
            </div>
            {/* Capability + tool tags */}
            <div className="pt-2 border-t border-[var(--border-color)] flex flex-wrap gap-1">
              {agent.capabilities.map((cap) => (
                <span key={cap} className="text-[11px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)]">
                  {cap}
                </span>
              ))}
              {backendConfig?.tools.map((t) => (
                <span key={t} className="text-[11px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)] font-mono">
                  {t}
                </span>
              ))}
            </div>
            {/* Approval commands */}
            {approvalPhrases.length > 0 && (
              <div className="mt-2 pt-2 border-t border-[var(--border-color)]">
                <div className="text-[10px] text-[var(--text-tertiary)] mb-1">Approval commands</div>
                <div className="flex flex-wrap gap-1">
                  {approvalPhrases.map((phrase) => (
                    <span key={phrase} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] font-mono" style={{ color: "#1D9E75" }}>
                      &quot;{phrase}&quot;
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Routines / Cron Jobs + Heartbeat (2-column) */}
          <div className="grid grid-cols-2 gap-4">
            {/* Routines */}
            <div>
              <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">Routines / Cron Jobs</div>
              {cronJobs.length > 0 ? (
                <div className="space-y-2">
                  {cronJobs.map((job) => (
                    <div key={job.id} className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)]">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              background: !job.lastRun
                                ? "#888"
                                : job.lastResult === "success"
                                ? "#1D9E75"
                                : "#E54D2E",
                            }}
                            title={job.lastResult || "Not yet run"}
                          />
                          <span className="text-xs font-medium text-[var(--text-primary)]">{job.name}</span>
                        </div>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--accent-blue)]">
                          {job.schedule}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] mb-1">{job.description}</div>
                      <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
                        <span>
                          {job.lastRun
                            ? `Last run: ${new Date(job.lastRun).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "short", timeStyle: "short" })}`
                            : "Not yet run"}
                        </span>
                        {job.logFile && (
                          <span className="font-mono truncate ml-2">
                            {job.logFile.split("/").pop()}
                          </span>
                        )}
                      </div>
                      {job.lastResult && job.lastResult !== "success" && (
                        <div className="text-[10px] text-[#E54D2E] mt-1 font-mono truncate">
                          {job.lastResult}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : backendConfig?.routines && backendConfig.routines.length > 0 ? (
                <div className="space-y-2">
                  {backendConfig.routines.map((r) => (
                    <div key={r.name} className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)]">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-[var(--text-primary)]">{r.name}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--accent-blue)]">{r.schedule}</span>
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">{r.description}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)] text-xs text-[var(--text-tertiary)]">
                  No scheduled routines
                </div>
              )}
            </div>

            {/* Heartbeat Checks */}
            <div>
              <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">Heartbeat Checks</div>
              {heartbeatJob ? (
                <div className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)] space-y-3">
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          background: !heartbeatJob.lastRun
                            ? "#888"
                            : heartbeatJob.lastResult === "success"
                            ? "#1D9E75"
                            : "#E54D2E",
                        }}
                      />
                      <span className="text-[var(--text-primary)] font-medium">
                        {heartbeatJob.lastRun ? "Active" : "Waiting for first run"}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--accent-blue)]">
                      {heartbeatJob.schedule}
                    </span>
                  </div>
                  {heartbeatJob.lastRun && (
                    <div className="text-[10px] text-[var(--text-tertiary)]">
                      Last run: {new Date(heartbeatJob.lastRun).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "short", timeStyle: "short" })}
                    </div>
                  )}
                  {heartbeatChecks.length > 0 ? (
                    <div className="space-y-1.5 pt-1 border-t border-[var(--border-color)]">
                      {heartbeatChecks.map((c) => (
                        <div key={c.name} className="flex items-start gap-2">
                          <span
                            className="text-[9px] font-bold uppercase px-1 py-0.5 rounded shrink-0 mt-0.5"
                            style={{
                              background: c.priority === "high" ? "#E54D2E22" : c.priority === "medium" ? "#F5A62322" : "#88888822",
                              color: c.priority === "high" ? "#E54D2E" : c.priority === "medium" ? "#F5A623" : "#888",
                            }}
                          >
                            {c.priority}
                          </span>
                          <div>
                            <div className="text-[11px] text-[var(--text-primary)] font-medium">{c.name}</div>
                            <div className="text-[10px] text-[var(--text-tertiary)]">{c.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[10px] text-[var(--text-tertiary)] pt-1 border-t border-[var(--border-color)]">
                      Health check only
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)] text-xs text-[var(--text-tertiary)]">
                  No heartbeat configured
                </div>
              )}
            </div>
          </div>

          {/* Backend Config */}
          {backendConfig && (
            <div>
              <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">Backend Config</div>
              <div className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)] text-xs font-mono space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-[var(--text-tertiary)] shrink-0 w-20">Session:</span>
                  <span className="text-[var(--accent-green)] break-all">{backendConfig.sessionFile}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[var(--text-tertiary)] shrink-0 w-20">Prompt:</span>
                  <span className="text-[var(--accent-green)] break-all">{backendConfig.systemPromptFile}</span>
                </div>
                {backendConfig.memoryDir && (
                  <div className="flex items-start gap-2">
                    <span className="text-[var(--text-tertiary)] shrink-0 w-20">Memory:</span>
                    <span className="text-[var(--accent-green)] break-all">{backendConfig.memoryDir}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* System Prompt (collapsible) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setPromptCollapsed(!promptCollapsed)}
                className="text-xs font-medium text-[var(--text-secondary)] flex items-center gap-1.5 hover:text-[var(--text-primary)]"
              >
                <svg
                  width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  className={`transition-transform ${promptCollapsed ? "" : "rotate-90"}`}
                >
                  <polyline points="9,6 15,12 9,18" />
                </svg>
                System Prompt
              </button>
            </div>
            {!promptCollapsed && (
              <div className="bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)] text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto">
                {promptText || "Loading..."}
              </div>
            )}
          </div>
        </div>
      </div>

    </>
  );
}
