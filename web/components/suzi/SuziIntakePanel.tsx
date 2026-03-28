"use client";

import { useState, useEffect, useCallback } from "react";
import IntakeCard, { type IntakeCardItem } from "./IntakeCard";
import { panelBus } from "@/lib/events";
import type { SuziFocusedIntake } from "@/lib/suzi-work-panel";

const PAGE_SIZE = 9;

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

interface SuziIntakePanelProps {
  onClose: () => void;
  embedded?: boolean;
  /** Lifted selection — green border + Suzi chat context. */
  focusedIntakeId?: string | null;
  onFocusedIntakeChange?: (item: SuziFocusedIntake | null) => void;
}

export default function SuziIntakePanel({
  onClose: _onClose,
  embedded = false,
  focusedIntakeId = null,
  onFocusedIntakeChange,
}: SuziIntakePanelProps) {
  const [items, setItems] = useState<IntakeCardItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  /** Draft in the search box; applied on icon click or Enter. */
  const [searchDraft, setSearchDraft] = useState("");
  /** Query sent to the API (and localStorage). */
  const [appliedSearch, setAppliedSearch] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("suzi_intake_search");
    if (saved) {
      setSearchDraft(saved);
      setAppliedSearch(saved);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("suzi_intake_search", appliedSearch);
  }, [appliedSearch]);

  const fetchItems = useCallback(async () => {
    const params = new URLSearchParams();
    if (appliedSearch.trim()) params.set("search", appliedSearch.trim());
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    try {
      const res = await fetch(`/api/intake?${params}`);
      const data = await res.json();
      setItems(data.items || []);
      setTotal(typeof data.total === "number" ? data.total : (data.items || []).length);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, page]);

  const maxPage = total > 0 ? Math.max(0, Math.ceil(total / PAGE_SIZE) - 1) : 0;
  useEffect(() => {
    if (page > maxPage) setPage(maxPage);
  }, [page, maxPage]);

  useEffect(() => {
    setLoading(true);
    fetchItems();
    const unsub = panelBus.on("intake", fetchItems);
    return unsub;
  }, [fetchItems]);

  const handleArchive = useCallback(
    async (id: string) => {
      if (onFocusedIntakeChange && focusedIntakeId === id) {
        onFocusedIntakeChange(null);
      }
      setItems((prev) => prev.filter((x) => x.id !== id));
      try {
        const res = await fetch("/api/intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "archive", id }),
        });
        await fetchItems();
      } catch {
        await fetchItems();
      }
    },
    [fetchItems, focusedIntakeId, onFocusedIntakeChange]
  );

  const toggleIntakeFocus = useCallback(
    (item: IntakeCardItem, displayNumber: number) => {
      if (!onFocusedIntakeChange) return;
      if (focusedIntakeId === item.id) {
        onFocusedIntakeChange(null);
        return;
      }
      onFocusedIntakeChange({
        id: item.id,
        title: item.title,
        url: item.url,
        body: item.body,
        source: item.source,
        displayNumber,
        filterQuery: appliedSearch.trim() || undefined,
      });
    },
    [appliedSearch, focusedIntakeId, onFocusedIntakeChange]
  );

  const runSearch = useCallback(() => {
    const q = searchDraft.trim();
    setAppliedSearch(q);
    setPage(0);
  }, [searchDraft]);

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      {!embedded && (
        <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
          <span className="text-base font-semibold text-[var(--text-primary)]">Intake</span>
          <span className="ml-auto text-base text-[var(--text-tertiary)] tabular-nums">
            {loading
              ? "Loading…"
              : total === 0
                ? "0 items"
                : total <= PAGE_SIZE
                  ? `${total} item${total !== 1 ? "s" : ""}`
                  : `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + items.length} of ${total}`}
          </span>
        </div>
      )}

      <div className="shrink-0 px-3 py-1.5 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-1.5 min-w-0">
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
            }}
            placeholder="Search…"
            className="flex-1 min-w-0 text-xs px-2 py-1.5 h-8 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
            aria-label="Search intake"
          />
          <button
            type="button"
            onClick={runSearch}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
            aria-label="Run search"
          >
            <SearchIcon />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 min-h-0 p-2 flex flex-col overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center min-h-0">
              <p className="text-base text-[var(--text-tertiary)]">Loading intake…</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex-1 flex items-center justify-center min-h-0">
              <div className="text-center px-2">
                <p className="text-base text-[var(--text-tertiary)]">
                  {appliedSearch.trim() ? "No items match" : "Nothing in Intake yet"}
                </p>
                <p className="text-sm text-[var(--text-tertiary)] mt-1">
                  Share from Android, email in, or use Add Intake in the tab header.
                </p>
              </div>
            </div>
          ) : (
            <div
              className="grid min-h-0 flex-1 grid-cols-3 gap-2 min-w-0"
              style={{
                gridTemplateRows: `repeat(${Math.min(3, Math.max(1, Math.ceil(items.length / 3)))}, minmax(0, 1fr))`,
              }}
            >
              {items.map((item, index) => (
                <IntakeCard
                  key={item.id}
                  item={item}
                  displayNumber={page * PAGE_SIZE + index + 1}
                  onArchive={handleArchive}
                  isFocused={focusedIntakeId === item.id}
                  onToggleFocus={
                    onFocusedIntakeChange
                      ? () => toggleIntakeFocus(item, page * PAGE_SIZE + index + 1)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>

        {total > 0 && (
          <div className="shrink-0 border-t border-[var(--border-color)] px-3 py-2 flex items-center justify-center gap-4 bg-[var(--bg-secondary)]">
            <button
              type="button"
              aria-label="Previous page"
              disabled={page <= 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="text-base px-2 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-primary)] disabled:opacity-35 disabled:cursor-not-allowed hover:bg-[var(--bg-primary)]"
            >
              ←
            </button>
            <span className="text-sm text-[var(--text-tertiary)] tabular-nums min-w-[7rem] text-center">
              {total <= PAGE_SIZE
                ? `${total} item${total !== 1 ? "s" : ""}`
                : `Page ${page + 1} / ${Math.max(1, Math.ceil(total / PAGE_SIZE))}`}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={(page + 1) * PAGE_SIZE >= total || loading}
              onClick={() => setPage((p) => p + 1)}
              className="text-base px-2 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-primary)] disabled:opacity-35 disabled:cursor-not-allowed hover:bg-[var(--bg-primary)]"
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
