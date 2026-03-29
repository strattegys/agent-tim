"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarniTopicAddModal from "./MarniTopicAddModal";
import MarniCorpusWordCloud from "./MarniCorpusWordCloud";
import { HUMAN_MANUAL_ACTION_BTN_CLASS } from "@/lib/suzi-work-panel";
import { topTermsFromChunks } from "@/lib/marni-corpus-terms";
import { MARNI_KNOWLEDGE_TAB_HEADER_HINT } from "@/lib/marni-work-panel";
import { panelBus } from "@/lib/events";

/** `response.json()` throws on HTML login/error pages (`Unexpected token '<'`). */
async function readApiJson<T = Record<string, unknown>>(r: Response): Promise<T> {
  const text = await r.text();
  const t = text.trim();
  if (
    t.startsWith("<!DOCTYPE") ||
    t.startsWith("<!doctype") ||
    t.startsWith("<html") ||
    t.startsWith("<HTML")
  ) {
    if (r.redirected || r.url.includes("/login")) {
      throw new Error("Session expired or not signed in — refresh the page and log in again.");
    }
    if (r.status === 404) {
      throw new Error(
        "Marni API routes are missing on this server (HTTP 404 HTML). " +
          "If you use Docker production: rebuild and redeploy the web image from current master. " +
          "If you run production compose locally behind Caddy and open http://localhost, Caddy must proxy that host (see Caddyfile http://localhost block); restart the caddy container after changing it. " +
          "If you use local Docker dev (docker-compose.dev.yml): use http://localhost:3001 and restart web; if it persists, delete web/.next on the host and restart. " +
          "Quick check (should return JSON): open /api/marni-kb/ping in the browser."
      );
    }
    throw new Error(
      `Server returned a web page instead of JSON (HTTP ${r.status}). Try refreshing or restarting the dev server.`
    );
  }
  if (!t) {
    throw new Error(`Empty response (HTTP ${r.status})`);
  }
  try {
    return JSON.parse(t) as T;
  } catch {
    throw new Error(
      t.length > 200 ? `${t.slice(0, 200)}…` : t || `Invalid JSON (HTTP ${r.status})`
    );
  }
}

const fetchOpts: RequestInit = { credentials: "same-origin" };

function RunSpinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? ""}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

interface KbTopic {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  queries: string[];
  postUrls: string[];
  sourceMode: string;
  cadenceMinutes: number | null;
  enabled: boolean;
  lastRunAt: string | null;
}

interface KbRun {
  id: string;
  topicId: string;
  status: string;
  sourcesFound: number;
  chunksIngested: number;
  errorMessage: string | null;
  detail: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
}

interface KbChunk {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type MarniKnowledgeFocus = { topicId: string; name: string };

interface MarniKnowledgePanelProps {
  onClose: () => void;
  /** Hide title bar + close (used inside Marni work panel second tab). */
  embedded?: boolean;
  /** Lifted to chat: selected topic while this panel is open (Knowledge Base tab). */
  onKnowledgeFocusChange?: (focus: MarniKnowledgeFocus | null) => void;
  /** Controlled from Marni work panel tab header — Add topic + modal. */
  addTopicOpen?: boolean;
  onAddTopicOpenChange?: (open: boolean) => void;
}

export default function MarniKnowledgePanel({
  onClose,
  embedded = false,
  onKnowledgeFocusChange,
  addTopicOpen: addTopicOpenProp,
  onAddTopicOpenChange,
}: MarniKnowledgePanelProps) {
  const [topics, setTopics] = useState<KbTopic[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalAddTopicOpen, setInternalAddTopicOpen] = useState(false);
  const addTopicModalControlled = onAddTopicOpenChange != null;
  const addTopicOpen = addTopicModalControlled ? Boolean(addTopicOpenProp) : internalAddTopicOpen;
  const setAddTopicOpen = (open: boolean) => {
    if (addTopicModalControlled) onAddTopicOpenChange(open);
    else setInternalAddTopicOpen(open);
  };
  const [runningTopicId, setRunningTopicId] = useState<string | null>(null);

  const [selTopicId, setSelTopicId] = useState<string>("");
  const [runs, setRuns] = useState<KbRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [chunks, setChunks] = useState<KbChunk[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadTopics = useCallback(() => {
    setLoadingTopics(true);
    setError(null);
    fetch("/api/marni-kb/topics", fetchOpts)
      .then(async (r) => {
        const data = await readApiJson<{ error?: string; topics?: KbTopic[] }>(r);
        if (!mounted.current) return;
        if (data.error) {
          setError(data.error);
          setTopics([]);
        } else {
          setTopics(data.topics || []);
        }
      })
      .catch((e) => {
        if (mounted.current) {
          setError(e instanceof Error ? e.message : "Failed to load topics");
          setTopics([]);
        }
      })
      .finally(() => {
        if (mounted.current) setLoadingTopics(false);
      });
  }, []);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  /** Chat invokes `knowledge_topic_create`; stream emits panelBus with that tool name — refetch so the list stays in sync without closing the panel. */
  useEffect(() => {
    const unsub = panelBus.on("knowledge_topic_create", () => loadTopics());
    return unsub;
  }, [loadTopics]);

  useEffect(() => {
    if (!selTopicId && topics.length > 0) setSelTopicId(topics[0].id);
  }, [topics, selTopicId]);

  const loadRuns = useCallback(() => {
    if (!selTopicId) {
      setRuns([]);
      return;
    }
    setLoadingRuns(true);
    fetch(`/api/marni-kb/runs?topicId=${encodeURIComponent(selTopicId)}`, fetchOpts)
      .then(async (r) => {
        const data = await readApiJson<{ runs?: KbRun[] }>(r);
        if (mounted.current) setRuns(data.runs || []);
      })
      .catch(() => {
        if (mounted.current) setRuns([]);
      })
      .finally(() => {
        if (mounted.current) setLoadingRuns(false);
      });
  }, [selTopicId]);

  const loadChunks = useCallback(() => {
    if (!selTopicId) {
      setChunks([]);
      return;
    }
    setLoadingChunks(true);
    const q = `?topicId=${encodeURIComponent(selTopicId)}&limit=200`;
    fetch(`/api/marni-kb/chunks${q}`, fetchOpts)
      .then(async (r) => {
        const data = await readApiJson<{ chunks?: KbChunk[] }>(r);
        if (mounted.current) setChunks(data.chunks || []);
      })
      .catch(() => {
        if (mounted.current) setChunks([]);
      })
      .finally(() => {
        if (mounted.current) setLoadingChunks(false);
      });
  }, [selTopicId]);

  useEffect(() => {
    if (selTopicId) loadRuns();
  }, [selTopicId, loadRuns]);

  useEffect(() => {
    loadChunks();
  }, [selTopicId, loadChunks]);

  const selectedTopic = topics.find((t) => t.id === selTopicId) ?? null;

  useEffect(() => {
    if (!onKnowledgeFocusChange) return;
    if (selectedTopic && selTopicId) {
      onKnowledgeFocusChange({ topicId: selTopicId, name: selectedTopic.name });
    } else {
      onKnowledgeFocusChange(null);
    }
  }, [onKnowledgeFocusChange, selectedTopic, selTopicId]);

  const corpusTerms = useMemo(() => topTermsFromChunks(chunks, 55), [chunks]);

  async function runTopic(id: string) {
    if (runningTopicId === id) return;
    setError(null);
    setRunningTopicId(id);
    try {
      const r = await fetch(`/api/marni-kb/topics/${id}/run`, {
        ...fetchOpts,
        method: "POST",
      });
      const data = await readApiJson<{ error?: string }>(r);
      if (!r.ok) throw new Error(data.error || "Run failed");
      loadTopics();
      loadRuns();
      loadChunks();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunningTopicId(null);
    }
  }

  async function deleteTopic(id: string) {
    if (!confirm("Delete this topic? Research runs are removed; knowledge chunks remain with topic unlinked.")) return;
    setError(null);
    try {
      const r = await fetch(`/api/marni-kb/topics/${id}`, {
        ...fetchOpts,
        method: "DELETE",
      });
      const data = await readApiJson<{ error?: string; ok?: boolean }>(r);
      if (!r.ok) {
        throw new Error(data.error || "Delete failed");
      }
      if (selTopicId === id) setSelTopicId("");
      loadTopics();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div
      className={`flex flex-col min-h-0 min-w-0 bg-[var(--bg-secondary)] ${
        embedded ? "flex-1 h-full overflow-hidden" : "h-full"
      }`}
    >
      <MarniTopicAddModal
        open={addTopicOpen}
        onClose={() => setAddTopicOpen(false)}
        onCreated={(id) => {
          loadTopics();
          setSelTopicId(id);
        }}
        onError={(msg) => setError(msg)}
      />

      {!embedded && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-color)]">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Knowledge Studio</h2>
            <p className="text-[10px] text-[var(--text-tertiary)]">
              Research topics, cadence, and RAG for LinkedIn playbooks
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
            title="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {!addTopicModalControlled && (
        <div className="shrink-0 min-h-10 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center justify-end gap-2 px-2 sm:px-3 py-1.5 overflow-x-auto">
          <div
            className="shrink-0 rounded-md border border-[var(--border-color)]/35 bg-[var(--bg-primary)]/25 px-2 py-1 mr-auto"
            role="note"
            aria-label={MARNI_KNOWLEDGE_TAB_HEADER_HINT}
          >
            <p className="text-[10px] sm:text-[11px] font-normal text-[var(--text-tertiary)]/90 leading-none whitespace-nowrap">
              {MARNI_KNOWLEDGE_TAB_HEADER_HINT}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAddTopicOpen(true)}
            title="Add a research topic"
            className={HUMAN_MANUAL_ACTION_BTN_CLASS}
          >
            Add topic
          </button>
        </div>
      )}

      {error && (
        <div className="shrink-0 mx-2 mt-2 text-[11px] text-red-400 bg-red-950/30 border border-red-500/30 rounded px-2 py-1.5">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden text-[11px] text-[var(--text-secondary)]">
        <div className="shrink-0 flex flex-col lg:flex-row border-b border-[var(--border-color)]">
          <div className="lg:flex-[3] min-w-0 w-full max-h-[min(42vh,22rem)] min-h-[160px] lg:min-h-[200px] overflow-y-auto p-2 sm:p-3 border-b lg:border-b-0 lg:border-r border-[var(--border-color)]">
            {loadingTopics ? (
              <p className="text-[var(--text-tertiary)] p-2">Loading topics…</p>
            ) : topics.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[8rem] text-center px-4">
                <p className="text-[var(--text-tertiary)] text-sm">No topics yet.</p>
                <p className="text-[var(--text-tertiary)] text-xs mt-1">
                  Use Add topic above to create your first research topic.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
                {topics.map((t) => {
                  const isSelected = selTopicId === t.id;
                  const isRunning = runningTopicId === t.id;
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelTopicId(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelTopicId(t.id);
                        }
                      }}
                      className={`rounded-lg border bg-[var(--bg-primary)] p-2.5 text-left cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#D4A017]/50 ${
                        isSelected
                          ? "border-[#D4A017]/55 ring-2 ring-[#D4A017]/35"
                          : "border-[var(--border-color)] hover:border-[var(--border-color)]/80"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-[var(--text-primary)] truncate">{t.name}</div>
                          <div className="text-[10px] text-[var(--text-tertiary)] font-mono truncate">{t.slug}</div>
                          {t.description && (
                            <p className="mt-1 text-[10px] text-[var(--text-secondary)] line-clamp-2">
                              {t.description}
                            </p>
                          )}
                          <p className="mt-1.5 text-[10px] text-[var(--text-tertiary)]">
                            {t.sourceMode} · {t.queries.length} quer{t.queries.length === 1 ? "y" : "ies"} ·{" "}
                            {t.cadenceMinutes ? `${t.cadenceMinutes}m cadence` : "manual"}
                            {t.lastRunAt && ` · last ${t.lastRunAt.slice(0, 16)}`}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            disabled={isRunning}
                            onClick={() => runTopic(t.id)}
                            className="inline-flex items-center justify-center gap-1.5 min-w-[5.5rem] px-2 py-1 rounded bg-[#D4A017]/20 text-[#D4A017] text-[10px] font-semibold hover:bg-[#D4A017]/30 disabled:opacity-45 disabled:pointer-events-none"
                          >
                            {isRunning ? (
                              <>
                                <RunSpinner className="text-[#D4A017]" />
                                <span>Running</span>
                              </>
                            ) : (
                              "Run now"
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={isRunning}
                            onClick={() => deleteTopic(t.id)}
                            className="px-2 py-0.5 rounded text-red-400/90 text-[10px] hover:bg-red-950/40 disabled:opacity-40"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="lg:flex-[2] lg:max-w-[40%] w-full min-h-[200px] h-[min(260px,36vh)] lg:h-[min(320px,min(42vh,22rem))] shrink-0 flex flex-col bg-[var(--bg-primary)]/25 border-[var(--border-color)]">
            <div className="shrink-0 flex items-center justify-between gap-2 px-2 sm:px-3 py-1 border-b border-[var(--border-color)]/60">
              {selTopicId ? (
                <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">{chunks.length} chunks</span>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={loadChunks}
                disabled={!selTopicId || loadingChunks}
                className="text-[10px] text-[#D4A017] hover:underline disabled:opacity-40 shrink-0"
              >
                {loadingChunks ? "Loading…" : "Refresh"}
              </button>
            </div>
            <div className="flex-1 min-h-0 min-w-0 p-2 relative">
              {!selTopicId ? (
                <p className="text-[10px] text-[var(--text-tertiary)] text-center px-2 pt-4">
                  Select a topic for a spiral word cloud from ingested chunks.
                </p>
              ) : loadingChunks && chunks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-[var(--text-tertiary)]">
                  <RunSpinner className="text-[#D4A017]" />
                  <p className="text-[10px]">Loading corpus…</p>
                </div>
              ) : corpusTerms.length === 0 ? (
                <p className="text-[10px] text-[var(--text-tertiary)] text-center px-2 pt-4">
                  No terms yet. Run research, then refresh.
                </p>
              ) : (
                <MarniCorpusWordCloud terms={corpusTerms} className="absolute inset-2 min-h-[140px]" />
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col border-t border-[var(--border-color)]">
          <div className="shrink-0 flex items-center justify-between gap-2 px-2 sm:px-3 py-1.5 bg-[var(--bg-primary)]/40 border-b border-[var(--border-color)]/60">
            <span className="text-[11px] font-semibold text-[var(--text-primary)]">
              Activity
              {selectedTopic ? (
                <span className="font-normal text-[var(--text-tertiary)]"> · {selectedTopic.name}</span>
              ) : (
                <span className="font-normal text-[var(--text-tertiary)]"> · select a topic</span>
              )}
            </span>
            <button
              type="button"
              onClick={loadRuns}
              disabled={!selTopicId || loadingRuns}
              className="text-[10px] text-[#D4A017] hover:underline disabled:opacity-40"
            >
              {loadingRuns ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 sm:p-3 space-y-2">
            {!selTopicId ? (
              <p className="text-[var(--text-tertiary)] text-[10px]">Select a topic card to see its run history.</p>
            ) : loadingRuns && runs.length === 0 ? (
              <p className="text-[var(--text-tertiary)] text-[10px]">Loading runs…</p>
            ) : runs.length === 0 ? (
              <p className="text-[var(--text-tertiary)] text-[10px]">No runs for this topic yet.</p>
            ) : (
              runs.map((r) => (
                <div
                  key={r.id}
                  className="rounded border border-[var(--border-color)] p-2 font-mono text-[10px]"
                >
                  <div className="flex justify-between gap-2">
                    <span className={r.status === "error" ? "text-red-400" : "text-[var(--text-primary)]"}>
                      {r.status}
                    </span>
                    <span className="text-[var(--text-tertiary)] shrink-0">{r.startedAt?.slice(0, 19)}</span>
                  </div>
                  <div>
                    sources {r.sourcesFound} · chunks {r.chunksIngested}
                  </div>
                  {Array.isArray(r.detail?.warnings) && (r.detail.warnings as string[]).length > 0 && (
                    <ul className="mt-1.5 text-amber-400/95 list-disc pl-4 space-y-0.5 normal-case">
                      {(r.detail.warnings as string[]).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                  {r.errorMessage && <div className="text-red-400 mt-1">{r.errorMessage}</div>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
