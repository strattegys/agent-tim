"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import PunchListCard, { type PunchListItem } from "./PunchListCard";
import { panelBus } from "@/lib/events";

const STATUS_FILTERS = ["All", "Open", "Done"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const FILTER_TO_STATUS: Record<string, "open" | "done" | undefined> = {
  All: undefined,
  Open: "open",
  Done: "done",
};

const RANK_LABELS: Record<number, string> = {
  1: "NOW",
  2: "LATER",
  3: "NEXT",
  4: "SOMETIME",
  5: "BACKLOG",
  6: "IDEA",
};

const RANK_COLORS: Record<number, string> = {
  1: "#a67070",
  2: "#a68970",
  3: "#a6a066",
  4: "#7fa67a",
  5: "#8888a8",
  6: "#8a9099",
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

  // Drag state
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dropTargetRank, setDropTargetRank] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragRef = useRef<{ itemId: string; sourceRank: number } | null>(null);

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

  // Group items by rank for Kanban columns
  const rankGroups = new Map<number, PunchListItem[]>();
  for (const item of items) {
    const group = rankGroups.get(item.rank) || [];
    group.push(item);
    rankGroups.set(item.rank, group);
  }
  const sortedRanks = [...rankGroups.keys()].sort((a, b) => a - b);

  // Status counts
  const statusCounts: Record<string, number> = { All: items.length };
  for (const item of items) {
    statusCounts[item.status === "open" ? "Open" : "Done"] =
      (statusCounts[item.status === "open" ? "Open" : "Done"] || 0) + 1;
  }

  // Category counts
  const categoryCounts: Record<string, number> = {};
  for (const item of items) {
    if (item.category && item.status === "open") {
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    }
  }
  const activeCategories = categories.filter((cat) => categoryCounts[cat] > 0);

  // ── Drag and Drop handlers ──

  const handleDragStart = (e: React.DragEvent, item: PunchListItem) => {
    setDragItemId(item.id);
    dragRef.current = { itemId: item.id, sourceRank: item.rank };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.id);
  };

  const handleDragEnd = () => {
    setDragItemId(null);
    setDropTargetRank(null);
    setDropIndex(null);
    dragRef.current = null;
  };

  const handleColumnDragOver = (e: React.DragEvent, rank: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetRank(rank);

    // Find which card we're hovering over to determine insert index
    const column = e.currentTarget as HTMLElement;
    const cards = column.querySelectorAll("[data-punch-id]");
    let insertIdx = cards.length; // default: append at end

    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        insertIdx = i;
        break;
      }
    }
    setDropIndex(insertIdx);
  };

  const handleColumnDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the column entirely
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !e.currentTarget.contains(related)) {
      setDropTargetRank(null);
      setDropIndex(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetRank: number) => {
    e.preventDefault();
    const itemId = e.dataTransfer.getData("text/plain");
    if (!itemId || !dragRef.current) return;

    const targetColumn = [...(rankGroups.get(targetRank) || [])];
    const sourceRank = dragRef.current.sourceRank;

    // Remove from source if same column
    const draggedItem = items.find((i) => i.id === itemId);
    if (!draggedItem) return;

    // Build new column order
    const filtered = targetColumn.filter((i) => i.id !== itemId);
    const insertAt = Math.min(dropIndex ?? filtered.length, filtered.length);
    filtered.splice(insertAt, 0, draggedItem);

    // Optimistic update
    setItems((prev) => {
      const updated = prev.map((item) => {
        if (item.id === itemId) {
          return { ...item, rank: targetRank };
        }
        return item;
      });
      return updated;
    });

    // Persist: send bulk reorder for the target column
    const reorder = filtered.map((item, idx) => ({
      id: item.id,
      rank: targetRank,
      sortOrder: idx,
    }));

    // If moving between columns, also reorder the source column
    if (sourceRank !== targetRank) {
      const sourceColumn = (rankGroups.get(sourceRank) || []).filter((i) => i.id !== itemId);
      sourceColumn.forEach((item, idx) => {
        reorder.push({ id: item.id, rank: sourceRank, sortOrder: idx });
      });
    }

    try {
      await fetch("/api/punch-list", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reorder }),
      });
      // Refetch to get authoritative order
      fetchItems();
    } catch {
      // Revert on failure
      fetchItems();
    }

    setDragItemId(null);
    setDropTargetRank(null);
    setDropIndex(null);
    dragRef.current = null;
  };

  return (
    <div className={embedded ? "flex-1 flex flex-col overflow-hidden min-w-0" : "flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0"}>
      {/* Header — hidden when embedded */}
      {!embedded && (
        <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
          <span className="text-xs font-semibold text-[var(--text-chat-body)]">
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
          className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-chat-body)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
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
                  ? "bg-[var(--accent-orange)]/85 text-[var(--text-primary)] font-medium"
                  : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-chat-body)] border border-[var(--border-color)]"
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
      {activeCategories.length > 0 && (
        <div className="shrink-0 px-3 py-1.5 flex gap-1 flex-wrap border-b border-[var(--border-color)]">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`text-[9px] px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
              !selectedCategory
                ? "bg-[var(--accent-green)]/90 text-[var(--text-primary)] font-medium"
                : "bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-chat-body)] border border-[var(--border-color)]"
            }`}
          >
            All
          </button>
          {activeCategories.map((cat) => {
            const count = categoryCounts[cat] || 0;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                className={`px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
                  selectedCategory === cat
                    ? "bg-[var(--accent-green)]/90 text-[var(--text-primary)] font-medium"
                    : "bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-chat-body)] border border-[var(--border-color)]"
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

      {/* Kanban board — horizontal columns by rank */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-[var(--text-tertiary)]">
              Loading punch list...
            </p>
          </div>
        ) : sortedRanks.length === 0 ? (
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
          <div className="flex gap-2 p-2 h-full">
            {sortedRanks.map((rank) => {
              const rankItems = rankGroups.get(rank) || [];
              const color = RANK_COLORS[rank] || "#9CA3AF";
              const label = RANK_LABELS[rank] || `Rank ${rank}`;
              const isDropTarget = dropTargetRank === rank;
              return (
                <div
                  key={rank}
                  className={`flex flex-col flex-1 min-w-0 rounded-lg border transition-colors ${
                    isDropTarget
                      ? "border-[var(--accent-green)] bg-[var(--accent-green)]/5"
                      : "border-[var(--border-color)] bg-[var(--bg-secondary)]"
                  }`}
                >
                  {/* Column header */}
                  <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0 opacity-75"
                      style={{ background: color }}
                    />
                    <span className="text-[11px] font-semibold truncate text-[var(--text-chat-body)]">
                      {label}
                    </span>
                    <span className="text-[10px] text-[var(--text-tertiary)] ml-auto shrink-0">
                      {rankItems.length}
                    </span>
                  </div>

                  {/* Cards — drop zone */}
                  <div
                    className="flex-1 overflow-y-auto p-2 space-y-2"
                    onDragOver={(e) => handleColumnDragOver(e, rank)}
                    onDragLeave={handleColumnDragLeave}
                    onDrop={(e) => handleDrop(e, rank)}
                  >
                    {rankItems.map((item, idx) => (
                      <div key={item.id}>
                        {/* Drop indicator line */}
                        {isDropTarget && dropIndex === idx && dragItemId !== item.id && (
                          <div className="h-0.5 bg-[var(--accent-green)] rounded-full mb-2 mx-1" />
                        )}
                        <div
                          data-punch-id={item.id}
                          draggable
                          onDragStart={(e) => {
                            // Only allow drag from the handle
                            const target = e.target as HTMLElement;
                            if (!target.closest("[data-drag-handle]")) {
                              e.preventDefault();
                              return;
                            }
                            handleDragStart(e, item);
                          }}
                          onDragEnd={handleDragEnd}
                          className={`relative transition-opacity ${
                            dragItemId === item.id ? "opacity-30" : ""
                          }`}
                        >
                          {/* Drag handle */}
                          <div
                            data-drag-handle
                            className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded cursor-grab text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                              <circle cx="3" cy="2" r="1" /><circle cx="7" cy="2" r="1" />
                              <circle cx="3" cy="5" r="1" /><circle cx="7" cy="5" r="1" />
                              <circle cx="3" cy="8" r="1" /><circle cx="7" cy="8" r="1" />
                            </svg>
                          </div>
                          <PunchListCard item={item} />
                        </div>
                      </div>
                    ))}
                    {/* Drop indicator at end */}
                    {isDropTarget && dropIndex === rankItems.length && (
                      <div className="h-0.5 bg-[var(--accent-green)] rounded-full mx-1" />
                    )}
                    {/* Empty column drop target */}
                    {rankItems.length === 0 && (
                      <div className="flex items-center justify-center h-16 text-[10px] text-[var(--text-tertiary)] border border-dashed border-[var(--border-color)] rounded-lg">
                        Drop here
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
