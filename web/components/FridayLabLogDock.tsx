"use client";

import { useCallback, useEffect, useState } from "react";

export type FridayLabLogEntry = { ts: number; text: string; seq?: number };

function formatLogCardTime(ts: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(new Date(ts));
  } catch {
    return String(ts);
  }
}

function formatInspectHeader(ts: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(new Date(ts));
  } catch {
    return String(ts);
  }
}

function workflowTraceSummary(text: string): { headline: string; hint?: string } {
  const t = text.trim();
  if (!t.startsWith("[workflow-trace]")) {
    const first = t.split("\n")[0] || t;
    return { headline: first.length > 72 ? `${first.slice(0, 69)}…` : first };
  }
  const jsonPart = t.replace(/^\[workflow-trace\]\s*/, "").trim();
  try {
    const o = JSON.parse(jsonPart) as Record<string, unknown>;
    const kind = typeof o.kind === "string" ? o.kind : "event";
    const parts: string[] = [kind];
    if (typeof o.jobId === "string") parts.push(String(o.jobId));
    if (typeof o.itemId === "string") parts.push(`item ${o.itemId.slice(0, 8)}…`);
    if (typeof o.workflowId === "string") parts.push(`wf ${o.workflowId.slice(0, 8)}…`);
    if (typeof o.packageId === "string") parts.push(`pkg ${o.packageId.slice(0, 8)}…`);
    if (typeof o.stage === "string") parts.push(o.stage);
    if (o.result === "error" && typeof o.error === "string") {
      return {
        headline: parts.join(" · "),
        hint: o.error.length > 120 ? o.error.slice(0, 117) + "…" : o.error,
      };
    }
    return { headline: parts.join(" · ") };
  } catch {
    return {
      headline: "workflow trace",
      hint: jsonPart.length > 100 ? jsonPart.slice(0, 97) + "…" : jsonPart,
    };
  }
}

function prettifyInspectText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[workflow-trace]")) return text;
  const rest = trimmed.replace(/^\[workflow-trace\]\s*/, "");
  try {
    const o = JSON.parse(rest);
    return `[workflow-trace]\n${JSON.stringify(o, null, 2)}`;
  } catch {
    return text;
  }
}

function LogInspectModal({ entry, onClose }: { entry: FridayLabLogEntry; onClose: () => void }) {
  const body = prettifyInspectText(entry.text);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(entry.text);
  }, [entry.text]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/55"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[min(85vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Workflow trace</h2>
            <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)] font-mono">
              {formatInspectHeader(entry.ts)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={copy}
              className="rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
            >
              Copy raw
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
            >
              Close
            </button>
          </div>
        </div>
        <pre className="flex-1 min-h-0 overflow-auto p-4 font-mono text-[11px] leading-relaxed text-[var(--text-chat-body)] whitespace-pre-wrap break-words">
          {body}
        </pre>
      </div>
    </div>
  );
}

function LogEntryCard({ entry, onInspect }: { entry: FridayLabLogEntry; onInspect: () => void }) {
  const { headline, hint } = workflowTraceSummary(entry.text);
  return (
    <button
      type="button"
      onClick={onInspect}
      className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-left transition-colors hover:border-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-green)]/50"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9px] font-mono text-[var(--text-tertiary)] tabular-nums shrink-0">
          {formatLogCardTime(entry.ts)}
        </span>
        <span className="text-[8px] uppercase tracking-wide text-[var(--text-tertiary)] shrink-0">View</span>
      </div>
      <div className="mt-0.5 text-[10px] font-semibold leading-snug text-[var(--text-primary)] line-clamp-2 break-words">
        {headline}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[9px] leading-snug text-[var(--text-secondary)] line-clamp-2 break-words">
          {hint}
        </div>
      ) : null}
    </button>
  );
}

interface FridayLabLogDockProps {
  fillRail?: boolean;
}

export default function FridayLabLogDock({ fillRail = false }: FridayLabLogDockProps) {
  const [entries, setEntries] = useState<FridayLabLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inspect, setInspect] = useState<FridayLabLogEntry | null>(null);

  const fetchLogs = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/dev/observability/logs?category=workflow&limit=80", {
        credentials: "include",
      });
      const d = (await r.json().catch(() => ({}))) as {
        error?: string;
        entries?: FridayLabLogEntry[];
      };
      if (!r.ok) {
        setError(d.error || `HTTP ${r.status}`);
      } else {
        setError(null);
        if (Array.isArray(d.entries)) setEntries(d.entries);
      }
    } catch {
      setError("Failed to load workflow traces");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const i = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      fetchLogs();
    }, 2500);
    return () => window.clearInterval(i);
  }, [fetchLogs]);

  const clearLogs = useCallback(async () => {
    await fetch("/api/dev/observability/logs", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear", category: "workflow" }),
    });
    fetchLogs();
  }, [fetchLogs]);

  const shown = [...entries].sort((a, b) => {
    const sb = typeof b.seq === "number" && Number.isFinite(b.seq) ? b.seq : 0;
    const sa = typeof a.seq === "number" && Number.isFinite(a.seq) ? a.seq : 0;
    if (sb !== sa) return sb - sa;
    return (Number(b.ts) || 0) - (Number(a.ts) || 0);
  });

  return (
    <div
      className={
        fillRail
          ? "flex flex-1 min-h-0 w-full min-w-0 flex-col border-t border-[var(--border-color)] bg-[var(--bg-secondary)]"
          : "flex min-h-[200px] max-h-[40vh] shrink-0 flex-col border-t border-[var(--border-color)] bg-[var(--bg-secondary)]"
      }
      aria-label="Friday lab workflow traces"
    >
      {inspect ? <LogInspectModal entry={inspect} onClose={() => setInspect(null)} /> : null}

      <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] px-2 py-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          Workflow traces
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void fetchLogs()}
          className="rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] disabled:opacity-50"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => void clearLogs()}
          className="rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]"
        >
          Clear
        </button>
        {error ? (
          <span className="max-w-[200px] truncate font-mono text-[9px] text-red-400" title={error}>
            {error}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 min-h-0 flex-col gap-1.5 overflow-y-auto p-2">
        {error && shown.length === 0 ? (
          <p className="text-[9px] leading-snug text-[var(--text-tertiary)]">
            Observation APIs must be on (next dev, or OBSERVATION_POST_API=1). {error}
          </p>
        ) : null}
        {shown.length === 0 && !error ? (
          <p className="text-[9px] leading-snug text-[var(--text-tertiary)]">
            No workflow events yet. Traces appear when Kanban items move, packages activate, workflows
            change stage, or cron jobs run (except high-frequency drains).
          </p>
        ) : null}
        {shown.map((entry, i) => (
          <LogEntryCard
            key={entry.seq != null ? `seq-${entry.seq}` : `ts-${entry.ts}-${i}`}
            entry={entry}
            onInspect={() => setInspect(entry)}
          />
        ))}
      </div>
    </div>
  );
}
