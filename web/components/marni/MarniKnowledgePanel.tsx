"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

type SubTab = "topics" | "activity" | "corpus" | "ask";

interface MarniKnowledgePanelProps {
  onClose: () => void;
  /** Hide title bar + close (used inside Marni work panel second tab). */
  embedded?: boolean;
}

export default function MarniKnowledgePanel({
  onClose,
  embedded = false,
}: MarniKnowledgePanelProps) {
  const [tab, setTab] = useState<SubTab>("topics");
  const [topics, setTopics] = useState<KbTopic[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newQueries, setNewQueries] = useState("");
  const [newPostUrls, setNewPostUrls] = useState("");
  const [newSourceMode, setNewSourceMode] = useState("web_only");
  const [newCadence, setNewCadence] = useState("");
  const [creating, setCreating] = useState(false);

  const [selTopicId, setSelTopicId] = useState<string>("");
  const [runs, setRuns] = useState<KbRun[]>([]);
  const [chunks, setChunks] = useState<KbChunk[]>([]);
  const [askQ, setAskQ] = useState("");
  const [askAnswer, setAskAnswer] = useState("");
  const [askCitations, setAskCitations] = useState<
    Array<{ title?: string; sourceUrl?: string; excerpt: string; score: number }>
  >([]);
  const [asking, setAsking] = useState(false);

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
    fetch("/api/marni-kb/topics")
      .then((r) => r.json())
      .then((data) => {
        if (!mounted.current) return;
        if (data.error) {
          setError(data.error);
          setTopics([]);
        } else {
          setTopics(data.topics || []);
        }
      })
      .catch(() => {
        if (mounted.current) {
          setError("Failed to load topics");
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

  useEffect(() => {
    if (!selTopicId && topics.length > 0) setSelTopicId(topics[0].id);
  }, [topics, selTopicId]);

  const loadRuns = useCallback(() => {
    if (!selTopicId) return;
    fetch(`/api/marni-kb/runs?topicId=${encodeURIComponent(selTopicId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (mounted.current) setRuns(data.runs || []);
      })
      .catch(() => {
        if (mounted.current) setRuns([]);
      });
  }, [selTopicId]);

  const loadChunks = useCallback(() => {
    const q = selTopicId
      ? `?topicId=${encodeURIComponent(selTopicId)}&limit=100`
      : "?limit=100";
    fetch(`/api/marni-kb/chunks${q}`)
      .then((r) => r.json())
      .then((data) => {
        if (mounted.current) setChunks(data.chunks || []);
      })
      .catch(() => {
        if (mounted.current) setChunks([]);
      });
  }, [selTopicId]);

  useEffect(() => {
    if (tab === "activity") loadRuns();
  }, [tab, loadRuns]);

  useEffect(() => {
    if (tab === "corpus") loadChunks();
  }, [tab, loadChunks]);

  async function createTopic() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    const queries = newQueries
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const postUrls = newPostUrls
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    let cadenceMinutes: number | null = null;
    if (newCadence.trim()) {
      const n = parseInt(newCadence, 10);
      if (Number.isFinite(n)) cadenceMinutes = Math.max(15, Math.min(10080, n));
    }
    try {
      const r = await fetch("/api/marni-kb/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: newDesc.trim() || null,
          queries,
          postUrls,
          sourceMode: newSourceMode,
          cadenceMinutes,
          enabled: true,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Create failed");
      setNewName("");
      setNewDesc("");
      setNewQueries("");
      setNewPostUrls("");
      setNewCadence("");
      loadTopics();
      if (data.topic?.id) setSelTopicId(data.topic.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function runTopic(id: string) {
    setError(null);
    try {
      const r = await fetch(`/api/marni-kb/topics/${id}/run`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Run failed");
      loadTopics();
      if (tab === "activity") loadRuns();
      if (tab === "corpus") loadChunks();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteTopic(id: string) {
    if (!confirm("Delete this topic? Research runs are removed; knowledge chunks remain with topic unlinked.")) return;
    setError(null);
    try {
      const r = await fetch(`/api/marni-kb/topics/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error || "Delete failed");
      }
      if (selTopicId === id) setSelTopicId("");
      loadTopics();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function ask() {
    const q = askQ.trim();
    if (!q) return;
    setAsking(true);
    setAskAnswer("");
    setAskCitations([]);
    try {
      const r = await fetch("/api/marni-kb/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Query failed");
      setAskAnswer(data.answer || "");
      setAskCitations(data.citations || []);
    } catch (e) {
      setAskAnswer(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  }

  const tabs: { id: SubTab; label: string }[] = [
    { id: "topics", label: "Topics" },
    { id: "activity", label: "Activity" },
    { id: "corpus", label: "Corpus" },
    { id: "ask", label: "Ask" },
  ];

  return (
    <div
      className={`flex flex-col min-h-0 min-w-0 bg-[var(--bg-secondary)] ${
        embedded ? "flex-1 h-full overflow-hidden" : "h-full"
      }`}
    >
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

      <div className="shrink-0 flex gap-0.5 px-2 pt-2 border-b border-[var(--border-color)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-2.5 py-1.5 text-[11px] font-medium rounded-t-md transition-colors ${
              tab === t.id
                ? "bg-[var(--bg-primary)] text-[#D4A017]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="shrink-0 mx-2 mt-2 text-[11px] text-red-400 bg-red-950/30 border border-red-500/30 rounded px-2 py-1.5">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-3 text-[11px] text-[var(--text-secondary)]">
        {tab === "topics" && (
          <div className="space-y-4">
            {loadingTopics ? (
              <p>Loading…</p>
            ) : (
              <div className="space-y-2">
                {topics.length === 0 ? (
                  <p className="text-[var(--text-tertiary)]">No topics yet. Add one below.</p>
                ) : (
                  topics.map((t) => (
                    <div
                      key={t.id}
                      className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-[var(--text-primary)]">{t.name}</div>
                          <div className="text-[10px] text-[var(--text-tertiary)] font-mono">{t.slug}</div>
                          {t.description && (
                            <p className="mt-1 text-[var(--text-secondary)]">{t.description}</p>
                          )}
                          <p className="mt-1 text-[10px]">
                            Mode: {t.sourceMode} · Queries: {t.queries.length} · Cadence:{" "}
                            {t.cadenceMinutes ? `${t.cadenceMinutes} min` : "manual"}
                            {t.lastRunAt && ` · Last: ${t.lastRunAt.slice(0, 16)}`}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => runTopic(t.id)}
                            className="px-2 py-0.5 rounded bg-[#D4A017]/20 text-[#D4A017] text-[10px] font-semibold hover:bg-[#D4A017]/30"
                          >
                            Run now
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteTopic(t.id)}
                            className="px-2 py-0.5 rounded text-red-400/90 text-[10px] hover:bg-red-950/40"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="rounded-lg border border-[var(--border-color)] border-dashed p-3 space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                New topic
              </div>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name"
                className="w-full rounded bg-[var(--bg-input)] border border-[var(--border-color)] px-2 py-1 text-[var(--text-primary)]"
              />
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Description (optional)"
                className="w-full rounded bg-[var(--bg-input)] border border-[var(--border-color)] px-2 py-1 text-[var(--text-primary)]"
              />
              <textarea
                value={newQueries}
                onChange={(e) => setNewQueries(e.target.value)}
                placeholder="Web search queries (one per line)"
                rows={3}
                className="w-full rounded bg-[var(--bg-input)] border border-[var(--border-color)] px-2 py-1 text-[var(--text-primary)] font-mono"
              />
              <textarea
                value={newPostUrls}
                onChange={(e) => setNewPostUrls(e.target.value)}
                placeholder="LinkedIn post URLs (one per line; Unipile ingestion coming soon)"
                rows={2}
                className="w-full rounded bg-[var(--bg-input)] border border-[var(--border-color)] px-2 py-1 text-[var(--text-primary)] font-mono"
              />
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value={newSourceMode}
                  onChange={(e) => setNewSourceMode(e.target.value)}
                  className="rounded bg-[var(--bg-input)] border border-[var(--border-color)] px-2 py-1 text-[var(--text-primary)]"
                >
                  <option value="web_only">Web only</option>
                  <option value="linkedin_only">LinkedIn only</option>
                  <option value="both">Both</option>
                </select>
                <input
                  value={newCadence}
                  onChange={(e) => setNewCadence(e.target.value)}
                  placeholder="Cadence (minutes, optional)"
                  className="w-40 rounded bg-[var(--bg-input)] border border-[var(--border-color)] px-2 py-1 text-[var(--text-primary)]"
                />
              </div>
              <button
                type="button"
                disabled={creating || !newName.trim()}
                onClick={createTopic}
                className="px-3 py-1 rounded bg-[#D4A017] text-black text-[11px] font-semibold disabled:opacity-40"
              >
                {creating ? "Creating…" : "Create topic"}
              </button>
            </div>
          </div>
        )}

        {tab === "activity" && (
          <div className="space-y-2">
            <label className="block text-[10px] text-[var(--text-tertiary)]">Topic</label>
            <select
              value={selTopicId}
              onChange={(e) => setSelTopicId(e.target.value)}
              className="w-full rounded bg-[var(--bg-input)] border border-[var(--border-color)] px-2 py-1 text-[var(--text-primary)] mb-2"
            >
              <option value="">Select…</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadRuns}
              className="text-[10px] text-[#D4A017] underline mb-2"
            >
              Refresh
            </button>
            {runs.length === 0 ? (
              <p className="text-[var(--text-tertiary)]">No runs for this topic.</p>
            ) : (
              runs.map((r) => (
                <div
                  key={r.id}
                  className="rounded border border-[var(--border-color)] p-2 font-mono text-[10px]"
                >
                  <div className="flex justify-between">
                    <span className={r.status === "error" ? "text-red-400" : "text-[var(--text-primary)]"}>
                      {r.status}
                    </span>
                    <span className="text-[var(--text-tertiary)]">{r.startedAt?.slice(0, 19)}</span>
                  </div>
                  <div>
                    sources {r.sourcesFound} · chunks {r.chunksIngested}
                  </div>
                  {r.errorMessage && <div className="text-red-400 mt-1">{r.errorMessage}</div>}
                </div>
              ))
            )}
          </div>
        )}

        {tab === "corpus" && (
          <div className="space-y-2">
            <label className="block text-[10px] text-[var(--text-tertiary)]">Filter by topic</label>
            <select
              value={selTopicId}
              onChange={(e) => setSelTopicId(e.target.value)}
              className="w-full rounded bg-[var(--bg-input)] border border-[var(--border-color)] px-2 py-1 text-[var(--text-primary)] mb-2"
            >
              <option value="">All chunks</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadChunks}
              className="text-[10px] text-[#D4A017] underline mb-2"
            >
              Refresh
            </button>
            {chunks.length === 0 ? (
              <p className="text-[var(--text-tertiary)]">No chunks yet. Run research on a topic.</p>
            ) : (
              chunks.map((c) => (
                <div key={c.id} className="rounded border border-[var(--border-color)] p-2 mb-2">
                  <div className="text-[10px] text-[var(--text-tertiary)] mb-1">
                    {(c.metadata?.title as string) || "chunk"} ·{" "}
                    {(c.metadata?.sourceUrl as string) || "—"}
                  </div>
                  <div className="text-[var(--text-secondary)] whitespace-pre-wrap">{c.content}</div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "ask" && (
          <div className="space-y-2">
            <textarea
              value={askQ}
              onChange={(e) => setAskQ(e.target.value)}
              placeholder="Ask about your knowledge base…"
              rows={3}
              className="w-full rounded bg-[var(--bg-input)] border border-[var(--border-color)] px-2 py-1 text-[var(--text-primary)]"
            />
            <button
              type="button"
              disabled={asking || !askQ.trim()}
              onClick={ask}
              className="px-3 py-1 rounded bg-[#D4A017] text-black text-[11px] font-semibold disabled:opacity-40"
            >
              {asking ? "…" : "Ask"}
            </button>
            {askCitations.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="text-[10px] font-semibold text-[var(--text-tertiary)]">Citations</div>
                {askCitations.map((c, i) => (
                  <div key={i} className="rounded border border-[var(--border-color)] p-2 text-[10px]">
                    <div className="text-[#D4A017]">
                      [{c.score}%] {c.title || "source"}{" "}
                      {c.sourceUrl && (
                        <a href={c.sourceUrl} className="underline break-all" target="_blank" rel="noreferrer">
                          {c.sourceUrl}
                        </a>
                      )}
                    </div>
                    <div className="text-[var(--text-secondary)] mt-1">{c.excerpt}</div>
                  </div>
                ))}
              </div>
            )}
            {askAnswer && (
              <div className="mt-3 rounded border border-[var(--border-color)] p-2 text-[var(--text-primary)] whitespace-pre-wrap">
                {askAnswer}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
