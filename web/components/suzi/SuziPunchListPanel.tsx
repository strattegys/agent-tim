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

const RANK_COLORS: Record<number, string> = {
  1: "#EF4444",
  2: "#F97316",
  3: "#F59E0B",
  4: "#EAB308",
  5: "#84CC16",
  6: "#22C55E",
  7: "#6366F1",
  8: "#9CA3AF",
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
  const [selectedRanks, setSelectedRanks] = useState<Set<number>>(new Set());
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

  // Filter items by rank client-side
  const filteredItems = selectedRanks.size > 0
    ? items.filter((item) => selectedRanks.has(item.rank))
    : items;

  // Status counts from filtered items
  const statusCounts: Record<string, number> = { All: filteredItems.length };
  for (const item of filteredItems) {
    statusCounts[item.status === "open" ? "Open" : "Done"] =
      (statusCounts[item.status === "open" ? "Open" : "Done"] || 0) + 1;
  }

  // Category counts from items (before rank filter so cloud reflects full dataset)
  const categoryCounts: Record<string, number> = {};
  for (const item of items) {
    if (item.category) {
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    }
  }

  // Available ranks from items
  const availableRanks = [...new Set(items.map((i) => i.rank))].sort((a, b) => a - b);

  const toggleRank = (rank: number) => {
    setSelectedRanks((prev) => {
      const next = new Set(prev);
      if (next.has(rank)) next.delete(rank);
      else next.add(rank);
      return next;
    });
  };

  return (
    <div className={embedded ? "flex-1 flex flex-col overflow-hidden min-w-0" : "flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0"}>
      {/* Header — hidden when embedded in reminders panel */}
      {!embedded && (
        <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
          <span className="text-xs font-semibold text-[var(--text-primary)]">
            Punch List
          </span>
          <span className="ml-auto text-xs text-[var(--text-tertiary)]">
            {loading ? "Loading..." : `${filteredItems.length} items`}
          </span>
        </div>
      )}

      {/* Item count when embedded */}
      {embedded && (
        <div className="shrink-0 px-3 py-1.5 border-b border-[var(--border-color)] flex items-center">
          <span className="text-xs text-[var(--text-tertiary)]">
            {loading ? "Loading..." : `${filteredItems.length} items`}
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

      {/* Category tag cloud */}
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
          {categories.map((cat) => {
            const count = categoryCounts[cat] || 0;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                className={`px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
                  selectedCategory === cat
                    ? "bg-[var(--accent-green)] text-white font-medium"
                    : "bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
                }`}
                style={{ fontSize: count > 5 ? 11 : count > 2 ? 10 : 9 }}
              >
                {cat}
                <span className="ml-1 opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Rank filter */}
      {availableRanks.length > 0 && (
        <div className="shrink-0 px-3 py-1.5 flex items-center gap-1 border-b border-[var(--border-color)]">
          <span className="text-[9px] text-[var(--text-tertiary)] mr-1">Rank</span>
          {availableRanks.map((rank) => (
            <button
              key={rank}
              onClick={() => toggleRank(rank)}
              className="text-[10px] w-5 h-5 rounded cursor-pointer transition-all flex items-center justify-center font-medium"
              style={{
                backgroundColor: selectedRanks.has(rank)
                  ? RANK_COLORS[rank] || "#9CA3AF"
                  : "var(--bg-secondary)",
                color: selectedRanks.has(rank) ? "#fff" : RANK_COLORS[rank] || "#9CA3AF",
                border: selectedRanks.has(rank)
                  ? "none"
                  : `1px solid ${RANK_COLORS[rank] || "#9CA3AF"}44`,
              }}
            >
              {rank}
            </button>
          ))}
          {selectedRanks.size > 0 && (
            <button
              onClick={() => setSelectedRanks(new Set())}
              className="text-[9px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] ml-1 cursor-pointer"
            >
              clear
            </button>
          )}
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
          filteredItems.map((item) => (
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
