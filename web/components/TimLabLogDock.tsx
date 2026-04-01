"use client";

import { useCallback, useEffect, useState } from "react";

export type TimLabLogEntry = { ts: number; text: string; seq?: number };

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

/** One-line summary for card face. */
function logCardSummary(text: string): { headline: string; hint?: string } {
  const t = text.trim();
  if (t.startsWith("[unipile-lab]")) {
    const jsonPart = t.replace(/^\[unipile-lab\]\s*/, "").trim();
    try {
      const o = JSON.parse(jsonPart) as Record<string, unknown>;
      const kind = typeof o.kind === "string" ? o.kind : "event";
      const route = typeof o.route === "string" ? o.route : null;
      const sender = typeof o.senderName === "string" ? o.senderName : null;
      const parts = [kind, route, sender].filter(Boolean) as string[];
      const headline = parts.length ? parts.join(" · ") : "Unipile";
      const hint =
        typeof o.messagePreview === "string" && o.messagePreview
          ? String(o.messagePreview).slice(0, 100) + (o.messagePreview.length > 100 ? "…" : "")
          : jsonPart.length > 90
            ? jsonPart.slice(0, 87) + "…"
            : undefined;
      return { headline, hint };
    } catch {
      return {
        headline: "Unipile",
        hint: jsonPart.length > 100 ? jsonPart.slice(0, 97) + "…" : jsonPart,
      };
    }
  }
  if (t.startsWith("[groq-debug-session]")) {
    const rest = t.slice("[groq-debug-session]".length).trimStart();
    const sep = rest.indexOf("\n\n");
    const headerStr = sep >= 0 ? rest.slice(0, sep) : rest;
    try {
      const o = JSON.parse(headerStr) as {
        agentId?: string;
        groqApiCalls?: number;
        userPreview?: string;
        startedAt?: string;
      };
      const calls =
        typeof o.groqApiCalls === "number" && Number.isFinite(o.groqApiCalls) ? o.groqApiCalls : "?";
      const headline = `Groq session · ${o.agentId ?? "?"} · ${calls} API calls`;
      const hint =
        typeof o.userPreview === "string" && o.userPreview
          ? o.userPreview.length > 100
            ? o.userPreview.slice(0, 97) + "…"
            : o.userPreview
          : typeof o.startedAt === "string"
            ? o.startedAt
            : undefined;
      return { headline, hint };
    } catch {
      return { headline: "Groq session", hint: headerStr.length > 90 ? headerStr.slice(0, 87) + "…" : headerStr };
    }
  }
  const firstLine = t.split("\n")[0] || t;
  if (firstLine.startsWith("[groq-debug]")) {
    const short =
      firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
    return { headline: short };
  }
  return {
    headline: firstLine.length > 70 ? `${firstLine.slice(0, 67)}…` : firstLine,
  };
}

function prettifyInspectText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("[unipile-lab]")) {
    const rest = trimmed.replace(/^\[unipile-lab\]\s*/, "");
    try {
      const o = JSON.parse(rest);
      return `[unipile-lab]\n${JSON.stringify(o, null, 2)}`;
    } catch {
      return text;
    }
  }
  if (trimmed.startsWith("[groq-debug-session]")) {
    const rest = trimmed.slice("[groq-debug-session]".length).trimStart();
    const sep = rest.indexOf("\n\n");
    if (sep >= 0) {
      const headerStr = rest.slice(0, sep);
      const body = rest.slice(sep + 2);
      try {
        const o = JSON.parse(headerStr);
        const blockSep = "\n\n────────────────────────────────────────\n\n";
        const parts = body.split(blockSep);
        const bodyNewestFirst =
          parts.length > 1 ? parts.slice().reverse().join(blockSep) : body;
        return `[groq-debug-session]\n${JSON.stringify(o, null, 2)}\n\n--- full trace (newest first) ---\n\n${bodyNewestFirst}`;
      } catch {
        return text;
      }
    }
    return text;
  }
  return text;
}

function LogInspectModal({
  category,
  entry,
  onClose,
}: {
  category: "unipile" | "groq";
  entry: TimLabLogEntry;
  onClose: () => void;
}) {
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
        aria-labelledby="tim-lab-log-inspect-title"
        className="flex max-h-[min(85vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3">
          <div className="min-w-0">
            <h2
              id="tim-lab-log-inspect-title"
              className="text-sm font-semibold text-[var(--text-primary)]"
            >
              {category === "unipile" ? "Unipile log" : "Groq / LLM log"}
            </h2>
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

function LogEntryCard({
  entry,
  onInspect,
}: {
  entry: TimLabLogEntry;
  onInspect: () => void;
}) {
  const { headline, hint } = logCardSummary(entry.text);
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
        <span className="text-[8px] uppercase tracking-wide text-[var(--text-tertiary)] shrink-0">
          View
        </span>
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

function LogCardColumn({
  title,
  entries,
  errorMessage,
  emptyHint,
  onClear,
  onInspect,
}: {
  title: string;
  entries: TimLabLogEntry[];
  errorMessage: string | null;
  emptyHint: string;
  onClear: () => void;
  onInspect: (entry: TimLabLogEntry) => void;
}) {
  const shown = [...entries].sort((a, b) => {
    const sb = typeof b.seq === "number" && Number.isFinite(b.seq) ? b.seq : 0;
    const sa = typeof a.seq === "number" && Number.isFinite(a.seq) ? a.seq : 0;
    if (sb !== sa) return sb - sa;
    const tb = Number(b.ts);
    const ta = Number(a.ts);
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-center justify-between bg-[var(--bg-primary)] px-2 py-1">
        <span className="text-[9px] font-semibold uppercase text-[var(--text-tertiary)]">{title}</span>
        <button
          type="button"
          onClick={onClear}
          className="text-[8px] uppercase text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        >
          Clear
        </button>
      </div>
      <div className="flex flex-1 min-h-0 flex-col gap-1.5 overflow-y-auto p-2">
        {errorMessage ? (
          <p className="rounded border border-amber-500/35 bg-amber-500/10 p-2 text-[9px] leading-snug text-amber-200">
            {errorMessage}
            {shown.length > 0
              ? " Showing the last load below; use Refresh now when the API is reachable again."
              : ""}
          </p>
        ) : null}
        {shown.length === 0 ? (
          <p className="text-[9px] leading-snug text-[var(--text-tertiary)]">{emptyHint}</p>
        ) : (
          shown.map((entry, i) => (
            <LogEntryCard
              key={entry.seq != null ? `seq-${entry.seq}` : `ts-${entry.ts}-${i}`}
              entry={entry}
              onInspect={() => onInspect(entry)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface TimLabLogDockProps {
  fillRail?: boolean;
}

export default function TimLabLogDock({ fillRail = false }: TimLabLogDockProps) {
  const [unipileEntries, setUnipileEntries] = useState<TimLabLogEntry[]>([]);
  const [groqEntries, setGroqEntries] = useState<TimLabLogEntry[]>([]);
  const [unipileError, setUnipileError] = useState<string | null>(null);
  const [groqError, setGroqError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<{
    category: "unipile" | "groq";
    entry: TimLabLogEntry;
  } | null>(null);

  const [groqDebugOn, setGroqDebugOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);

  const loadToggles = useCallback(() => {
    fetch("/api/dev/observability", { credentials: "include" })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as {
          error?: string;
          toggles?: { key: string; effective: boolean }[];
        };
        if (!r.ok) {
          setGroqDebugOn(null);
          return;
        }
        const row = d.toggles?.find((t) => t.key === "GROQ_CHAT_DEBUG");
        setGroqDebugOn(row?.effective ?? false);
      })
      .catch(() => setGroqDebugOn(null));
  }, []);

  const fetchLogs = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [ru, rg] = await Promise.all([
        fetch("/api/dev/observability/logs?category=unipile&limit=60", {
          credentials: "include",
        }),
        fetch("/api/dev/observability/logs?category=groq&limit=60", {
          credentials: "include",
        }),
      ]);
      const du = (await ru.json().catch(() => ({}))) as {
        error?: string;
        entries?: TimLabLogEntry[];
      };
      const dg = (await rg.json().catch(() => ({}))) as {
        error?: string;
        entries?: TimLabLogEntry[];
      };
      if (!ru.ok) {
        setUnipileError(du.error || `Unipile log HTTP ${ru.status}`);
        // Do not clear on transient errors (401 blip, 404 gate, network) — keep last good snapshot until Refresh succeeds.
      } else {
        setUnipileError(null);
        if (Array.isArray(du.entries)) setUnipileEntries(du.entries);
      }
      if (!rg.ok) {
        setGroqError(dg.error || `Groq log HTTP ${rg.status}`);
      } else {
        setGroqError(null);
        if (Array.isArray(dg.entries)) setGroqEntries(dg.entries);
      }
    } catch {
      setError("Failed to load logs");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    loadToggles();
  }, [loadToggles]);

  useEffect(() => {
    fetchLogs();
    const i = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      fetchLogs();
    }, 2000);
    return () => window.clearInterval(i);
  }, [fetchLogs]);

  const enableGroqDebug = useCallback(async () => {
    setToggleBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/dev/observability", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "GROQ_CHAT_DEBUG", value: true }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setGroqDebugOn(true);
      await fetchLogs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    } finally {
      setToggleBusy(false);
    }
  }, [fetchLogs]);

  const clearUnipile = useCallback(async () => {
    await fetch("/api/dev/observability/logs", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear", category: "unipile" }),
    });
    fetchLogs();
  }, [fetchLogs]);

  const clearGroq = useCallback(async () => {
    await fetch("/api/dev/observability/logs", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear", category: "groq" }),
    });
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div
      className={
        fillRail
          ? "flex flex-1 min-h-0 w-full flex-col border-t border-[var(--border-color)] bg-[var(--bg-secondary)]"
          : "flex shrink-0 flex-col border-t border-[var(--border-color)] bg-[var(--bg-secondary)] min-h-[220px] max-h-[42vh]"
      }
      aria-label="Tim lab logs"
    >
      {inspect ? (
        <LogInspectModal
          category={inspect.category}
          entry={inspect.entry}
          onClose={() => setInspect(null)}
        />
      ) : null}

      <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] px-2 py-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          Tim lab
        </span>
        {groqDebugOn === false ? (
          <button
            type="button"
            disabled={toggleBusy}
            onClick={enableGroqDebug}
            className="rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            {toggleBusy ? "…" : "Enable Groq debug"}
          </button>
        ) : groqDebugOn === true ? (
          <span className="text-[9px] font-mono text-[#1D9E75]">Groq debug on</span>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={fetchLogs}
          className="rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] disabled:opacity-50"
        >
          Refresh now
        </button>
        {error ? (
          <span className="max-w-[140px] truncate font-mono text-[9px] text-red-400" title={error}>
            {error}
          </span>
        ) : null}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-[var(--border-color)]">
        <LogCardColumn
          title="Unipile"
          entries={unipileEntries}
          errorMessage={unipileError}
          emptyHint="No entries yet. Webhooks, replay, or TIM_LAB_UNIPILE_LOG in non-dev builds."
          onClear={clearUnipile}
          onInspect={(entry) => setInspect({ category: "unipile", entry })}
        />
        <LogCardColumn
          title="Groq / LLM"
          entries={groqEntries}
          errorMessage={groqError}
          emptyHint="No entries yet. Turn on Groq debug, send Tim a message — one card appears per turn (full trace inside). Refresh now pulls from the server buffer; Clear wipes it. Use GROQ_CHAT_DEBUG=1 in .env.local if toggles do not stick across workers."
          onClear={clearGroq}
          onInspect={(entry) => setInspect({ category: "groq", entry })}
        />
      </div>
    </div>
  );
}
