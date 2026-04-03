"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentConfig } from "@/lib/agent-frontend";
import { getAgentSpec } from "@/lib/agent-registry";

type CronJobRow = {
  id: string;
  name: string;
  schedule: string;
  description: string;
  lastRun: string | null;
  lastResult: string | null;
  enabled: boolean;
};

/**
 * Compact agent ops in the status rail when the main work column is not showing AgentInfoPanel.
 */
export default function StatusRailAgentInspector({
  activeAgent,
  hidden,
}: {
  activeAgent: AgentConfig;
  /** When true (e.g. work panel is on full Agent info), omit this block to avoid duplication. */
  hidden: boolean;
}) {
  const [jobs, setJobs] = useState<CronJobRow[]>([]);
  const [cronLoading, setCronLoading] = useState(true);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  const closePrompt = useCallback(() => setPromptOpen(false), []);

  useEffect(() => {
    if (hidden) return;
    const ac = new AbortController();
    setCronLoading(true);
    fetch(`/api/cron-status?agent=${encodeURIComponent(activeAgent.id)}`, {
      credentials: "include",
      signal: ac.signal,
    })
      .then((r) => r.json())
      .then((data: { jobs?: CronJobRow[] }) => {
        setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      })
      .catch(() => setJobs([]))
      .finally(() => setCronLoading(false));
    return () => ac.abort();
  }, [activeAgent.id, hidden]);

  useEffect(() => {
    if (!promptOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePrompt();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [promptOpen, closePrompt]);

  useEffect(() => {
    if (!promptOpen) return;
    setPromptText("");
    setPromptError(null);
    setPromptLoading(true);
    const ac = new AbortController();
    fetch(`/api/system-prompt?agent=${encodeURIComponent(activeAgent.id)}`, {
      credentials: "include",
      signal: ac.signal,
    })
      .then((res) => res.json())
      .then((data: { prompt?: string; error?: string }) => {
        if (data.prompt) setPromptText(data.prompt);
        else setPromptError(data.error || "Could not load prompt");
      })
      .catch(() => setPromptError("Could not load prompt"))
      .finally(() => setPromptLoading(false));
    return () => ac.abort();
  }, [promptOpen, activeAgent.id]);

  if (hidden) return null;

  const spec = getAgentSpec(activeAgent.id);
  const tools = spec.tools;

  return (
    <>
      <section className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
          {activeAgent.name}
        </div>
        <p className="text-[8px] leading-snug text-[var(--text-tertiary)] font-mono mb-2">
          While the work panel is not on full Agent info, cron and tools for the selected agent appear here.
        </p>

        <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
          Cron
        </div>
        {cronLoading ? (
          <p className="font-mono text-[9px] text-[var(--text-tertiary)] mb-2">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="font-mono text-[9px] text-[var(--text-tertiary)] mb-2">No jobs for this agent</p>
        ) : (
          <ul className="mb-2 max-h-40 overflow-y-auto space-y-1.5 font-mono text-[9px] leading-snug">
            {jobs.map((job) => (
              <li key={job.id} className="border-b border-[var(--border-color)] pb-1.5 last:border-0 last:pb-0">
                <div className="flex items-start gap-1 min-w-0">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0 mt-0.5"
                    style={{
                      background: !job.lastRun
                        ? "#6b7280"
                        : job.lastResult === "success"
                          ? "#1D9E75"
                          : "#E54D2E",
                    }}
                    title={job.lastResult || "Not yet run"}
                  />
                  <span className="min-w-0 flex-1 text-[var(--text-secondary)]">
                    <span className="text-[var(--text-primary)] font-medium">{job.name}</span>
                    <span className="block text-[var(--accent-blue)] mt-0.5">{job.schedule}</span>
                    {job.description ? (
                      <span className="block text-[var(--text-tertiary)] mt-0.5 line-clamp-2">{job.description}</span>
                    ) : null}
                    {job.lastRun ? (
                      <span className="block text-[var(--text-tertiary)] mt-0.5">
                        Last: {new Date(job.lastRun).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                      </span>
                    ) : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
          Tools
        </div>
        <div className="flex flex-wrap gap-0.5 mb-2">
          {tools.map((t) => (
            <span
              key={t}
              className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-1 py-0.5 font-mono text-[8px] text-[var(--text-primary)]"
            >
              {t}
            </span>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setPromptOpen(true)}
          className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          System prompt…
        </button>
      </section>

      {promptOpen ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          role="presentation"
          onClick={closePrompt}
        >
          <div className="absolute inset-0 bg-black/50" aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="status-rail-prompt-title"
            className="relative z-10 flex max-h-[min(85vh,40rem)] w-full max-w-2xl flex-col rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--border-color)] px-4 py-3">
              <h2 id="status-rail-prompt-title" className="text-sm font-semibold text-[var(--text-primary)]">
                System prompt — {activeAgent.name}
              </h2>
              <button
                type="button"
                onClick={closePrompt}
                className="shrink-0 rounded p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                aria-label="Close dialog"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {promptLoading ? (
                <p className="text-xs text-[var(--text-tertiary)]">Loading…</p>
              ) : promptError ? (
                <p className="text-xs text-[var(--accent-orange)]">{promptError}</p>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
                  {promptText || "(empty)"}
                </pre>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
