"use client";

import { useState, useEffect, useRef } from "react";
import type { AgentConfig } from "@/lib/agent-frontend";
import { compressAvatarImage } from "@/lib/compress-avatar-image";
import { getAgentSpec } from "@/lib/agent-registry";


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
  vectorMemory?: boolean;
}

interface MemoryHealthPayload {
  enabled: boolean;
  agentId: string;
  mode: "none" | "vector" | "file";
  ok: boolean;
  ephemeral: boolean;
  memoryDir?: string;
  database?: "ok" | "unavailable" | "error";
  databaseDetail?: string;
  memoryCount?: number;
  embeddings?: "ok" | "missing_key" | "error";
  embeddingDetail?: string;
  fileBackend?: "ok" | "deferred" | "error";
  fileDetail?: string;
}

interface VoiceRuntime {
  registryVoiceId: string | null;
  inworldKeyPresent: boolean;
  envFallbackVoiceId: string | null;
  groqPresent: boolean;
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
  const [voiceRuntime, setVoiceRuntime] = useState<VoiceRuntime | null>(null);
  /** undefined = loading; null = no memory tool or fetch failed; object = health payload */
  const [memoryHealth, setMemoryHealth] = useState<MemoryHealthPayload | null | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load all dashboard data on agent change
  useEffect(() => {
    setPromptText("");
    setBackendConfig(null);
    setApprovalPhrases([]);
    setCronJobs([]);
    setAgentSummary("");
    setPromptCollapsed(true);
    setVoiceRuntime(null);
    setMemoryHealth(undefined);

    fetch(`/api/agent-summary?agent=${agent.id}`)
      .then((res) => res.json())
      .then((data) => { if (data.summary) setAgentSummary(data.summary); })
      .catch(() => {});

    fetch(`/api/agent-config?agent=${agent.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.approvalPhrases) setApprovalPhrases(data.approvalPhrases);
        if (data.config) setBackendConfig(data.config);
        if (data.voiceRuntime && typeof data.voiceRuntime === "object") {
          setVoiceRuntime(data.voiceRuntime as VoiceRuntime);
        }
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

    if (!getAgentSpec(agent.id).tools.includes("memory")) {
      setMemoryHealth(null);
    } else {
      fetch(`/api/memory-health?agent=${agent.id}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data: MemoryHealthPayload) => {
          if (data && typeof data.enabled === "boolean") setMemoryHealth(data);
          else setMemoryHealth(null);
        })
        .catch(() => setMemoryHealth(null));
    }
  }, [agent.id]);

  const heartbeatJob = cronJobs.find((j) => j.id === `heartbeat-${agent.id}`);
  const heartbeatChecks =
    agent.id === "tim"
      ? [
          { name: "LinkedIn Alerts", desc: "Flags inbound messages with no user response in last 2 hours", priority: "high" },
          { name: "Memory Reminders", desc: "Scans memory for follow-ups, todos, and deadlines due today", priority: "medium" },
          { name: "Scheduled Messages", desc: "Detects failed or overdue scheduled LinkedIn messages", priority: "high" },
          { name: "Workflow Health", desc: "Checks for empty or inactive workflows in CRM", priority: "low" },
        ]
      : (getAgentSpec(agent.id).heartbeat?.checks ?? []).map((c) => ({
          name: c.name,
          desc: c.description,
          priority: c.priority,
        }));

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      alert("Image must be under 25MB");
      return;
    }

    const uploadAbort = new AbortController();
    const uploadTimer = window.setTimeout(() => uploadAbort.abort(), 60_000);
    try {
      const compressed = await compressAvatarImage(file);
      const form = new FormData();
      form.append("file", new File([compressed], `${agent.id}-avatar.png`, { type: "image/png" }));
      form.append("agentId", agent.id);
      const res = await fetch("/api/agent-avatar", {
        method: "POST",
        credentials: "include",
        body: form,
        signal: uploadAbort.signal,
      });
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
      const msg = err instanceof Error ? err.message : "Unknown error";
      alert(
        err instanceof DOMException && err.name === "AbortError"
          ? "Upload timed out"
          : `Upload failed: ${msg}`
      );
    } finally {
      clearTimeout(uploadTimer);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <div className="flex-1 bg-[var(--bg-secondary)] flex flex-col overflow-y-auto">
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
              {getAgentSpec(agent.id).tools.includes("memory") && (
                <div className="flex items-start gap-2 text-xs pt-1 border-t border-[var(--border-color)]">
                  {(() => {
                    const mh = memoryHealth;
                    const dot =
                      mh === undefined
                        ? "#888"
                        : mh === null
                          ? "#E54D2E"
                          : mh.mode === "file"
                            ? mh.ok
                              ? "#1D9E75"
                              : "#E54D2E"
                            : mh.ok
                              ? "#1D9E75"
                              : mh.database === "ok" && mh.embeddings !== "ok"
                                ? "#F59E0B"
                                : "#E54D2E";
                    const headline =
                      mh === undefined
                        ? "Checking…"
                        : mh === null
                          ? "Unavailable"
                          : mh.mode === "file"
                            ? mh.ok
                              ? "Ready"
                              : "Error"
                            : mh.ok
                              ? "Ready"
                              : mh.database === "ok"
                                ? "Embeddings issue"
                                : mh.embeddings === "ok"
                                  ? "Database issue"
                                  : "Needs setup";
                    const modeLabel =
                      mh && mh !== null && mh.enabled
                        ? mh.mode === "vector"
                          ? "Semantic (CRM + Gemini)"
                          : mh.ephemeral
                            ? "File (local ephemeral)"
                            : "File (MEMORY.md)"
                        : "Long-term memory";
                    return (
                      <>
                        <span
                          className="w-2 h-2 rounded-full shrink-0 mt-1"
                          style={{ background: dot }}
                          title={mh === undefined ? "Loading memory status…" : undefined}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[var(--text-primary)]">{modeLabel}</span>
                            <span className="text-[11px] shrink-0" style={{ color: dot }}>
                              {headline}
                            </span>
                          </div>
                          {mh && mh.enabled && mh.mode === "vector" && (
                            <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5 leading-snug space-y-0.5">
                              <div>
                                Database:{" "}
                                {mh.database === "ok"
                                  ? `OK (${mh.memoryCount ?? 0} memories)`
                                  : mh.database === "unavailable"
                                    ? "Not connected"
                                    : "Error"}
                                {mh.databaseDetail && mh.database !== "ok" ? (
                                  <span className="block text-[#E54D2E] mt-0.5">{mh.databaseDetail}</span>
                                ) : null}
                              </div>
                              <div>
                                Embeddings:{" "}
                                {mh.embeddings === "ok"
                                  ? "OK (Gemini)"
                                  : mh.embeddings === "missing_key"
                                    ? "GEMINI_API_KEY missing"
                                    : "Error"}
                                {mh.embeddingDetail && mh.embeddings !== "ok" ? (
                                  <span className="block text-[#F59E0B] mt-0.5">{mh.embeddingDetail}</span>
                                ) : null}
                              </div>
                            </div>
                          )}
                          {mh && mh.enabled && mh.mode === "file" && mh.memoryDir && (
                            <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5 font-mono break-all">
                              {mh.fileDetail ? (
                                <span className={mh.ok ? "text-[var(--text-tertiary)]" : "text-[#E54D2E]"}>
                                  {mh.fileDetail}
                                </span>
                              ) : (
                                mh.memoryDir
                              )}
                            </div>
                          )}
                          {(mh === null || (mh && mh.enabled && !mh.ok)) && (
                            <div className="text-[10px] text-[var(--text-tertiary)] mt-1">
                              {mh === null
                                ? "Could not load memory status. Check dev server logs and CRM / env."
                                : mh.mode === "vector" && mh.database === "unavailable"
                                  ? "Use the same CRM_DB_* settings as db:exec, run migrate-vector-memory.sql on the workspace schema, and set GEMINI_API_KEY."
                                  : null}
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
              {agent.ttsVoice && (
                <div className="flex items-start gap-2 text-xs pt-1 border-t border-[var(--border-color)]">
                  <span
                    className="w-2 h-2 rounded-full shrink-0 mt-1"
                    style={{
                      background:
                        voiceRuntime == null
                          ? "#888"
                          : voiceRuntime.inworldKeyPresent
                            ? "#1D9E75"
                            : "#E54D2E",
                    }}
                    title={voiceRuntime == null ? "Loading voice status…" : undefined}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[var(--text-primary)]">Voice (Inworld)</span>
                      <span
                        className="text-[11px] shrink-0"
                        style={{
                          color:
                            voiceRuntime == null
                              ? "#888"
                              : voiceRuntime.inworldKeyPresent
                                ? "#1D9E75"
                                : "#E54D2E",
                        }}
                      >
                        {voiceRuntime == null
                          ? "…"
                          : voiceRuntime.inworldKeyPresent
                            ? "Ready"
                            : "API key missing"}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5 leading-snug">
                      Voice ID <span className="font-mono text-[var(--text-secondary)]">{agent.ttsVoice}</span>
                      {voiceRuntime?.envFallbackVoiceId ? (
                        <span>
                          {" "}
                          · env fallback <span className="font-mono">{voiceRuntime.envFallbackVoiceId}</span>
                        </span>
                      ) : null}
                      {voiceRuntime && !voiceRuntime.groqPresent ? (
                        <span className="block mt-1 text-[#F59E0B]">
                          GROQ_API_KEY unset — long replies use truncation before TTS.
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
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
