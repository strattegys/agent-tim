"use client";

import { useState, useEffect, useCallback } from "react";
import NoteCard, { type Note } from "./NoteCard";
import { panelBus } from "@/lib/events";

interface SuziNotesPanelProps {
  onClose: () => void;
  embedded?: boolean;
}

export default function SuziNotesPanel({ onClose, embedded = false }: SuziNotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("suzi_notes_tag") || null;
    }
    return null;
  });
  const [search, setSearch] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("suzi_notes_search") || "";
    }
    return "";
  });

  // Persist filter state
  useEffect(() => {
    if (selectedTag) {
      localStorage.setItem("suzi_notes_tag", selectedTag);
    } else {
      localStorage.removeItem("suzi_notes_tag");
    }
  }, [selectedTag]);
  useEffect(() => {
    localStorage.setItem("suzi_notes_search", search);
  }, [search]);

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch("/api/notes?tags=true");
      const data = await res.json();
      setTags(data.tags || []);
    } catch {
      // ignore
    }
  }, []);

  const fetchNotes = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (selectedTag) params.set("tag", selectedTag);

    try {
      const res = await fetch(`/api/notes?${params}`);
      const data = await res.json();
      setNotes(data.notes || []);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [search, selectedTag]);

  useEffect(() => {
    setLoading(true);
    fetchNotes();
    fetchTags();
    const unsub = panelBus.on("notes", () => {
      fetchNotes();
      fetchTags();
    });
    return unsub;
  }, [fetchNotes, fetchTags]);

  const handleDelete = useCallback(async (id: string) => {
    // Optimistic removal
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "delete", id }),
      });
      if (!res.ok) {
        // Revert on failure
        fetchNotes();
      }
      fetchTags();
    } catch {
      fetchNotes();
    }
  }, [fetchNotes, fetchTags]);

  const pinnedCount = notes.filter((n) => n.pinned).length;

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      {/* Header (hidden when embedded in sub-tab view) */}
      {!embedded && (
        <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
          <span className="text-xs font-semibold text-[var(--text-primary)]">
            Notes
          </span>
          <span className="ml-auto text-xs text-[var(--text-tertiary)]">
            {loading
              ? "Loading..."
              : `${notes.length} note${notes.length !== 1 ? "s" : ""}${pinnedCount > 0 ? ` (${pinnedCount} pinned)` : ""}`}
          </span>
        </div>
      )}

      {/* Search */}
      <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)]">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search notes..."
          className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
        />
      </div>

      {/* Tag filter pills */}
      {tags.length > 0 && (
        <div className="shrink-0 px-3 py-1.5 flex gap-1 flex-wrap border-b border-[var(--border-color)]">
          <button
            onClick={() => setSelectedTag(null)}
            className={`text-[9px] px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
              !selectedTag
                ? "bg-[var(--accent-green)] text-white font-medium"
                : "bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
            }`}
          >
            All
          </button>
          {tags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={`text-[9px] px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
                selectedTag === tag
                  ? "bg-[var(--accent-green)] text-white font-medium"
                  : "bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-[var(--text-tertiary)]">
              Loading notes...
            </p>
          </div>
        ) : notes.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <p className="text-sm text-[var(--text-tertiary)]">
                {search || selectedTag
                  ? "No notes match your filters"
                  : "No notes yet"}
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Ask Suzi to add one!
              </p>
            </div>
          </div>
        ) : (
          notes.map((note) => <NoteCard key={note.id} note={note} onDelete={handleDelete} />)
        )}
      </div>
    </div>
  );
}
