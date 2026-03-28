"use client";

import { useState, useEffect, useCallback } from "react";
import IntakeCard, { type IntakeCardItem } from "./IntakeCard";
import { panelBus } from "@/lib/events";

interface SuziIntakePanelProps {
  onClose: () => void;
  embedded?: boolean;
}

export default function SuziIntakePanel({ onClose: _onClose, embedded = false }: SuziIntakePanelProps) {
  const [items, setItems] = useState<IntakeCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [titleIn, setTitleIn] = useState("");
  const [urlIn, setUrlIn] = useState("");
  const [bodyIn, setBodyIn] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("suzi_intake_search");
    if (saved) setSearch(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem("suzi_intake_search", search);
  }, [search]);

  const fetchItems = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    try {
      const res = await fetch(`/api/intake?${params}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    setLoading(true);
    fetchItems();
    const unsub = panelBus.on("intake", fetchItems);
    return unsub;
  }, [fetchItems]);

  const handleAdd = async () => {
    const title = titleIn.trim();
    if (!title) return;
    setSaving(true);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "add",
          title,
          url: urlIn.trim() || undefined,
          body: bodyIn.trim() || undefined,
          source: "ui",
        }),
      });
      if (res.ok) {
        setTitleIn("");
        setUrlIn("");
        setBodyIn("");
        fetchItems();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = useCallback(
    async (id: string) => {
      setItems((prev) => prev.filter((x) => x.id !== id));
      try {
        const res = await fetch("/api/intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "delete", id }),
        });
        if (!res.ok) fetchItems();
      } catch {
        fetchItems();
      }
    },
    [fetchItems]
  );

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      {!embedded && (
        <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
          <span className="text-xs font-semibold text-[var(--text-primary)]">Intake</span>
          <span className="ml-auto text-xs text-[var(--text-tertiary)]">
            {loading ? "Loading…" : `${items.length} item${items.length !== 1 ? "s" : ""}`}
          </span>
        </div>
      )}

      <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] space-y-2">
        <p className="text-[10px] text-[var(--text-tertiary)]">
          Quick add — or tell Suzi: &quot;add an intake item …&quot;
        </p>
        <input
          type="text"
          value={titleIn}
          onChange={(e) => setTitleIn(e.target.value)}
          placeholder="Title *"
          className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
        />
        <input
          type="url"
          value={urlIn}
          onChange={(e) => setUrlIn(e.target.value)}
          placeholder="URL (optional)"
          className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
        />
        <textarea
          value={bodyIn}
          onChange={(e) => setBodyIn(e.target.value)}
          placeholder="Note / snippet (optional)"
          rows={2}
          className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)] resize-none"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={saving || !titleIn.trim()}
          className="text-xs px-3 py-1.5 rounded-lg bg-[#D85A30] text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
        >
          {saving ? "Saving…" : "Add to Intake"}
        </button>
      </div>

      <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)]">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search intake…"
          className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-[var(--text-tertiary)]">Loading intake…</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <p className="text-sm text-[var(--text-tertiary)]">
                {search.trim() ? "No items match" : "Nothing in Intake yet"}
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">Share from Android, email yourself, or add above.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {items.map((item, index) => (
              <IntakeCard
                key={item.id}
                item={item}
                displayNumber={index + 1}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
