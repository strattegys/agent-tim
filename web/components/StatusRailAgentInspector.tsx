"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentConfig } from "@/lib/agent-frontend";
import { getAgentSpec } from "@/lib/agent-registry";

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
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  const closePrompt = useCallback(() => setPromptOpen(false), []);

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
      <section className="shrink-0 min-w-0 mt-4">
        <div className="flex items-start justify-between gap-2 mb-2.5 min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] min-w-0 truncate">
            {activeAgent.name}
          </div>
          <button
            type="button"
            onClick={() => setPromptOpen(true)}
            className="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)] transition-colors"
          >
            System prompt
          </button>
        </div>
        <p className="text-[8px] leading-snug text-[var(--text-tertiary)] font-mono mb-2">
          While the work panel is not on full Agent info, tool connections for the selected agent appear here.
        </p>

        <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
          Tools
        </div>
        <div className="flex flex-wrap gap-0.5 mb-0.5">
          {tools.map((t) => (
            <span
              key={t}
              className="rounded px-1 py-0.5 font-mono text-[8px] text-[var(--text-secondary)] bg-[var(--bg-tertiary)]/80"
            >
              {t}
            </span>
          ))}
        </div>
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
