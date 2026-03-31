"use client";

import { useEffect, useState } from "react";
import { readMarniKbApiJson } from "@/lib/marni-kb-api-read";
import type { KbStudioAgentId } from "@/lib/kb-studio";

const fetchOpts: RequestInit = { credentials: "same-origin" };

interface MarniTopicAddModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (topicId: string) => void;
  onError: (message: string) => void;
  /** Which agent owns new topics (vector corpus namespace). */
  kbAgentId?: KbStudioAgentId;
}

export default function MarniTopicAddModal({
  open,
  onClose,
  onCreated,
  onError,
  kbAgentId = "marni",
}: MarniTopicAddModalProps) {
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newQueries, setNewQueries] = useState("");
  const [newPostUrls, setNewPostUrls] = useState("");
  const [newSourceMode, setNewSourceMode] = useState("web_only");
  const [newCadence, setNewCadence] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      setNewName("");
      setNewDesc("");
      setNewQueries("");
      setNewPostUrls("");
      setNewSourceMode("web_only");
      setNewCadence("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function submit() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
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
        ...fetchOpts,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: kbAgentId,
          name,
          description: newDesc.trim() || null,
          queries,
          postUrls,
          sourceMode: newSourceMode,
          cadenceMinutes,
          enabled: true,
        }),
      });
      const data = await readMarniKbApiJson<{ error?: string; topic?: { id?: string } }>(r);
      if (!r.ok) throw new Error(data.error || "Create failed");
      const id = data.topic?.id;
      if (id) onCreated(id);
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="marni-topic-add-title"
    >
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" aria-hidden onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl p-4 space-y-3 max-h-[min(90vh,36rem)] flex flex-col">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <h2 id="marni-topic-add-title" className="text-sm font-semibold text-[var(--text-primary)]">
            Add topic
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-2 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Close
          </button>
        </div>
        <div className="space-y-2 overflow-y-auto min-h-0 flex-1 text-[11px]">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name *"
            className="w-full text-sm px-2.5 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[#D4A017]/70"
            autoFocus
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full text-sm px-2.5 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[#D4A017]/70"
          />
          <textarea
            value={newQueries}
            onChange={(e) => setNewQueries(e.target.value)}
            placeholder="Web search queries (one per line)"
            rows={3}
            className="w-full rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] px-2.5 py-2 text-[var(--text-primary)] font-mono text-xs outline-none focus:border-[#D4A017]/70"
          />
          <textarea
            value={newPostUrls}
            onChange={(e) => setNewPostUrls(e.target.value)}
            placeholder="LinkedIn post URLs (one per line)"
            rows={2}
            className="w-full rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] px-2.5 py-2 text-[var(--text-primary)] font-mono text-xs outline-none focus:border-[#D4A017]/70"
          />
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={newSourceMode}
              onChange={(e) => setNewSourceMode(e.target.value)}
              className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] px-2 py-1.5 text-[var(--text-primary)] text-xs"
            >
              <option value="web_only">Web only</option>
              <option value="linkedin_only">LinkedIn only</option>
              <option value="both">Both</option>
            </select>
            <input
              value={newCadence}
              onChange={(e) => setNewCadence(e.target.value)}
              placeholder="Cadence (minutes, optional)"
              className="flex-1 min-w-[10rem] rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] px-2 py-1.5 text-[var(--text-primary)] text-xs"
            />
          </div>
        </div>
        <div className="shrink-0 flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={creating || !newName.trim()}
            onClick={submit}
            className="text-xs px-3 py-1.5 rounded-md bg-[#D4A017] text-black font-semibold disabled:opacity-40"
          >
            {creating ? "Creating…" : "Create topic"}
          </button>
        </div>
      </div>
    </div>
  );
}
