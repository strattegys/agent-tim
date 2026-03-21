"use client";

import { useState, useEffect, useCallback } from "react";
import PunchListCard, { type PunchListItem } from "./PunchListCard";
import { panelBus } from "@/lib/events";

const STATUS_FILTERS = ["All", "Open", "Done"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const FILTER_TO_STATUS: Record<string, "open" | "done" | undefined> = {
  All: undefined,
  Open: "open",
  Done: "done",
};

interface SuziPunchListPanelProps {
  onClose: () => void;
  embedded?: boolean;
}

export default function SuziPunchListPanel({
  onClose,
  embedded = false,
}: SuziPunchListPanelProps) {
  const [items, setItems] = useState<PunchListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("suzi_punchlist_filter");
      if (saved && STATUS_FILTERS.includes(saved as StatusFilter))
        return saved as StatusFilter;
    }
    return "Open";
  });
  const [search, setSearch] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("suzi_punchlist_search") || "";
    }
    return "";
  });

  // Persist filter state
  useEffect(() => {
    localStorage.setItem("suzi_punchlist_filter", statusFilter);
  }, [statusFilter]);
  useEffect(() => {
    localStorage.setItem("suzi_punchlist_search", search);
  }, [search]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/punch-list?categories=true");
      const data = await res.json();
      setCategories(data.categories || []);
    } catch {
      // ignore
    }
  }, []);

  const fetchItems = useCallback(async () => {
    const params = new URLSearchParams();
    const status = FILTER_TO_STATUS[statusFilter];
    if (status) params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    if (selectedCategory) params.set("category", selectedCategory);

    try {
      const res = await fetch(`/api/punch-list?${params}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, selectedCategory]);

  useEffect(() => {
    setLoading(true);
    fetchItems();
    fetchCategories();
    const unsub = panelBus.on("punch_list", () => {
      fetchItems();
      fetchCategories();
    });
    return unsub;
  }, [fetchItems, fetchCategories]);

  // Status counts from current items
  const statusCounts: Record<string, number> = { All: items.length };
  for (const item of items) {
    statusCounts[item.status === "open" ? "Open" : "Done"] =
      (statusCounts[item.status === "open" ? "Open" : "Done"] || 0) + 1;
  }

  return (
    <div className={embedded ? "flex-1 flex flex-col overflow-hidden min-w-0" : "flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0"}>
      {/* Header — hidden when embedded in reminders panel */}
      {!embedded && (
        <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
          <span className="text-xs font-semibold text-[var(--text-primary)]">
            Punch List
          </span>
          <span className="ml-auto text-xs text-[var(--text-tertiary)]">
            {loading ? "Loading..." : `${items.length} items`}
          </span>
        </div>
      )}

      {/* Item count when embedded */}
      {embedded && (
        <div className="shrink-0 px-3 py-1.5 border-b border-[var(--border-color)] flex items-center">
          <span className="text-xs text-[var(--text-tertiary)]">
            {loading ? "Loading..." : `${items.length} items`}
          </span>
        </div>
      )}

      {/* Search */}
      <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)]">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search punch list..."
          className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
        />
      </div>

      {/* Status filter pills */}
      <div className="shrink-0 px-3 py-2 flex gap-1.5 border-b border-[var(--border-color)]">
        {STATUS_FILTERS.map((sf) => {
          const count = statusCounts[sf] || 0;
          return (
            <button
              key={sf}
              onClick={() => setStatusFilter(sf)}
              className={`text-[10px] px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                statusFilter === sf
                  ? "bg-[#D85A30] text-white font-medium"
                  : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
              }`}
            >
              {sf}
              {count > 0 && (
                <span className="ml-1 opacity-70">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Category filter pills */}
      {categories.length > 0 && (
        <div className="shrink-0 px-3 py-1.5 flex gap-1 flex-wrap border-b border-[var(--border-color)]">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`text-[9px] px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
              !selectedCategory
                ? "bg-[var(--accent-green)] text-white font-medium"
                : "bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
              className={`text-[9px] px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
                selectedCategory === cat
                  ? "bg-[var(--accent-green)] text-white font-medium"
                  : "bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Item list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-[var(--text-tertiary)]">
              Loading punch list...
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <p className="text-sm text-[var(--text-tertiary)]">
                {search || selectedCategory
                  ? "No items match your filters"
                  : statusFilter === "All"
                    ? "No punch list items yet"
                    : `No ${statusFilter.toLowerCase()} items`}
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Ask Suzi to add one!
              </p>
            </div>
          </div>
        ) : (
          items.map((item) => (
            <PunchListCard
              key={item.id}
              item={item}
            />
          ))
        )}
      </div>
    </div>
  );
}
