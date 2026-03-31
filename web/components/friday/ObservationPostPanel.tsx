"use client";

import { useCallback, useEffect, useState } from "react";

type ToggleRow = {
  key: string;
  label: string;
  description: string;
  envOn: boolean;
  override: boolean | null;
  effective: boolean;
};

type ReadOnlyRow = {
  key: string;
  label: string;
  description: string;
  on: boolean;
};

type LogCategory = "groq" | "http";

export default function ObservationPostPanel() {
  const [toggles, setToggles] = useState<ToggleRow[]>([]);
  const [readOnly, setReadOnly] = useState<ReadOnlyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [logCategory, setLogCategory] = useState<LogCategory>("groq");
  const [logBody, setLogBody] = useState<string>("");
  const [logHint, setLogHint] = useState<string | null>(null);
  const [logBusy, setLogBusy] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    return fetch("/api/dev/observability", { credentials: "include" })
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as {
          error?: string;
          toggles?: ToggleRow[];
          readOnly?: ReadOnlyRow[];
        };
        if (!r.ok) {
          setError(data.error || `HTTP ${r.status}`);
          setToggles([]);
          setReadOnly([]);
          return;
        }
        setToggles(data.toggles || []);
        setReadOnly(data.readOnly || []);
      })
      .catch(() => {
        setError("Failed to load");
        setToggles([]);
        setReadOnly([]);
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const fetchLogBuffer = useCallback(async () => {
    setLogBusy(true);
    setLogError(null);
    try {
      if (logCategory === "groq") {
        const r = await fetch("/api/dev/observability/logs?category=groq&limit=100", {
          credentials: "include",
        });
        const d = (await r.json().catch(() => ({}))) as {
          error?: string;
          entries?: { ts: number; text: string }[];
        };
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        const entries = d.entries || [];
        setLogHint(null);
        setLogBody(
          entries.length === 0
            ? "(No entries yet. Turn on Groq chat debug above, run a chat turn, then Refresh.)"
            : entries
                .map(
                  (e) =>
                    `[${new Date(e.ts).toISOString()}]\n${e.text}`
                )
                .join("\n\n───\n\n")
        );
      } else {
        const r = await fetch("/api/dev/observability/edge-logs?limit=250", {
          credentials: "include",
        });
        const d = (await r.json().catch(() => ({}))) as {
          error?: string;
          hint?: string;
          entries?: { ts: number; method: string; pathname: string }[];
        };
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        const entries = d.entries || [];
        setLogHint(typeof d.hint === "string" ? d.hint : null);
        setLogBody(
          entries.length === 0
            ? "(No /api requests recorded yet — try Refresh after some traffic.)"
            : entries
                .map(
                  (e) =>
                    `${new Date(e.ts).toISOString()}  ${e.method.padEnd(6)} ${e.pathname}`
                )
                .join("\n")
        );
      }
    } catch (e) {
      setLogError(e instanceof Error ? e.message : "Load failed");
      setLogBody("");
      setLogHint(null);
    } finally {
      setLogBusy(false);
    }
  }, [logCategory]);

  useEffect(() => {
    if (loading) return;
    if (error && toggles.length === 0) return;
    void fetchLogBuffer();
  }, [loading, error, toggles.length, logCategory, fetchLogBuffer]);

  const clearLogBuffer = async () => {
    setLogBusy(true);
    setLogError(null);
    try {
      if (logCategory === "groq") {
        const r = await fetch("/api/dev/observability/logs", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "clear", category: "groq" }),
        });
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      } else {
        const r = await fetch("/api/dev/observability/edge-logs", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "clear" }),
        });
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      }
      await fetchLogBuffer();
    } catch (e) {
      setLogError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setLogBusy(false);
    }
  };

  const patchToggle = async (key: string, value: boolean | null) => {
    setBusyKey(key);
    setError(null);
    try {
      const r = await fetch("/api/dev/observability", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        error?: string;
        toggles?: ToggleRow[];
      };
      if (!r.ok) {
        setError(data.error || `HTTP ${r.status}`);
        return;
      }
      if (data.toggles) setToggles(data.toggles);
    } catch {
      setError("Update failed");
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-[var(--text-tertiary)]">Loading observation post…</p>
      </div>
    );
  }

  if (error && toggles.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-sm text-[var(--text-tertiary)]">{error}</p>
        <p className="text-xs text-[var(--text-tertiary)] max-w-sm">
          This panel needs a signed-in session. It is only available in development or when{" "}
          <code className="text-[10px] bg-[var(--bg-secondary)] px-1 rounded">DEV_UNIPILE_INBOUND_REPLAY=1</code>{" "}
          is set (same as other dev APIs).
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
      <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <h3 className="text-[11px] font-semibold text-[var(--text-primary)] uppercase tracking-wide">
          Environment & logging
        </h3>
        <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 leading-snug">
          Toggles apply immediately for this server process (no restart). They override{" "}
          <code className="text-[9px]">web/.env.local</code> until you reset or restart.
        </p>
      </div>

      {error ? (
        <div className="mx-3 mt-2 text-xs text-amber-600 dark:text-amber-400">{error}</div>
      ) : null}

      <ul className="divide-y divide-[var(--border-color)] shrink-0">
        {toggles.map((t) => (
          <li key={t.key} className="px-3 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-[var(--text-primary)]">{t.label}</span>
                  <code className="text-[9px] text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-1 rounded">
                    {t.key}
                  </code>
                </div>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 leading-relaxed">{t.description}</p>
                <p className="text-[9px] text-[var(--text-tertiary)] mt-1">
                  .env: {t.envOn ? "on" : "off"}
                  {t.override !== null ? (
                    <>
                      {" · "}
                      <span className="text-[var(--accent-orange)]">override active</span>
                    </>
                  ) : (
                    " · following .env"
                  )}
                </p>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1">
                <button
                  type="button"
                  role="switch"
                  aria-checked={t.effective}
                  disabled={busyKey === t.key}
                  onClick={() => patchToggle(t.key, !t.effective)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${
                    t.effective ? "bg-[var(--accent-green)]" : "bg-[var(--border-color)]"
                  } ${busyKey === t.key ? "opacity-50" : ""}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      t.effective ? "translate-x-4" : ""
                    }`}
                  />
                </button>
                {t.override !== null ? (
                  <button
                    type="button"
                    disabled={busyKey === t.key}
                    onClick={() => patchToggle(t.key, null)}
                    className="text-[9px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] underline disabled:opacity-50"
                  >
                    Use .env only
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {readOnly.length > 0 ? (
        <>
          <div className="shrink-0 px-3 py-2 border-t border-b border-[var(--border-color)] bg-[var(--bg-secondary)] mt-1">
            <h3 className="text-[11px] font-semibold text-[var(--text-primary)] uppercase tracking-wide">
              Read-only (restart to change)
            </h3>
            <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
              Shown for context; set in <code className="text-[9px]">.env.local</code> and restart the web process.
            </p>
          </div>
          <ul className="divide-y divide-[var(--border-color)] shrink-0">
            {readOnly.map((r) => (
              <li key={r.key} className="px-3 py-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-xs font-medium text-[var(--text-primary)]">{r.label}</span>
                  <code className="text-[9px] text-[var(--text-tertiary)] ml-1.5">{r.key}</code>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{r.description}</p>
                </div>
                <span
                  className={`shrink-0 text-[10px] font-medium tabular-nums ${
                    r.on ? "text-[var(--accent-green)]" : "text-[var(--text-tertiary)]"
                  }`}
                >
                  {r.on ? "on" : "off"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="shrink-0 px-3 py-2 border-t border-[var(--border-color)] bg-[var(--bg-secondary)] mt-1">
        <h3 className="text-[11px] font-semibold text-[var(--text-primary)] uppercase tracking-wide">
          Buffered log slice
        </h3>
        <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 leading-snug">
          Pick a category and load on demand. Buffers are capped (Groq ~120 blocks, HTTP ~300 lines) and cleared on process restart.
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <label className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1.5">
            <span>Category</span>
            <select
              value={logCategory}
              onChange={(e) => setLogCategory(e.target.value as LogCategory)}
              className="text-[10px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-1.5 py-0.5 text-[var(--text-primary)]"
            >
              <option value="groq">Groq debug ([groq-debug])</option>
              <option value="http">HTTP — /api via middleware</option>
            </select>
          </label>
          <button
            type="button"
            disabled={logBusy}
            onClick={() => void fetchLogBuffer()}
            className="text-[10px] font-medium px-2 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
          >
            {logBusy ? "Loading…" : "Refresh"}
          </button>
          <button
            type="button"
            disabled={logBusy}
            onClick={() => void clearLogBuffer()}
            className="text-[10px] font-medium px-2 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            Clear buffer
          </button>
        </div>
        {logHint ? (
          <p className="text-[9px] text-[var(--text-tertiary)] mt-2 leading-relaxed italic">{logHint}</p>
        ) : null}
        {logError ? (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-2">{logError}</p>
        ) : null}
      </div>

      <div className="flex-1 min-h-[160px] max-h-[min(50vh,380px)] mx-3 mb-3 mt-1 border border-[var(--border-color)] rounded bg-[var(--bg-primary)] overflow-hidden flex flex-col">
        <pre className="flex-1 overflow-auto p-2 text-[10px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-words">
          {logBody}
        </pre>
      </div>
    </div>
  );
}
