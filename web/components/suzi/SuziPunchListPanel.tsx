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
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addDesc, setAddDesc] = useState("");
  const [addRank, setAddRank] = useState(4);
  const [editingItem, setEditingItem] = useState<PunchListItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editRank, setEditRank] = useState(4);

  // Persist filter state
  useEffect(() => {
    localStorage.setItem("suzi_punchlist_filter", statusFilter);
  }, [statusFilter]);
  useEffect(() => {
    localStorage.setItem("suzi_punchlist_search", search);
  }, [search]);

  const fetchItems = useCallback(async () => {
    const params = new URLSearchParams();
    const status = FILTER_TO_STATUS[statusFilter];
    if (status) params.set("status", status);
    if (search.trim()) params.set("search", search.trim());

    try {
      const res = await fetch(`/api/punch-list?${params}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    setLoading(true);
    fetchItems();
    const unsub = panelBus.on("punch_list", fetchItems);
    return unsub;
  }, [fetchItems]);

  const handleToggleStatus = async (
    id: string,
    status: "open" | "done"
  ) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status } : item))
    );
    await fetch("/api/punch-list", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
  };

  const handleDelete = async (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setItems((prev) => prev.filter((item) => item.id !== id));
    setConfirmDelete(null);
    await fetch("/api/punch-list", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  const handleAdd = async () => {
    if (!addTitle.trim()) return;
    try {
      const res = await fetch("/api/punch-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: addTitle.trim(),
          description: addDesc.trim() || undefined,
          rank: addRank,
        }),
      });
      const data = await res.json();
      if (data.item) {
        setItems((prev) => [data.item, ...prev]);
      }
      setAddTitle("");
      setAddDesc("");
      setAddRank(4);
      setShowAddForm(false);
    } catch {
      // ignore
    }
  };

  const handleEditStart = (item: PunchListItem) => {
    setEditingItem(item);
    setEditTitle(item.title);
    setEditDesc(item.description || "");
    setEditRank(item.rank);
  };

  const handleEditSave = async () => {
    if (!editingItem || !editTitle.trim()) return;
    const updates: Record<string, unknown> = {};
    if (editTitle.trim() !== editingItem.title)
      updates.title = editTitle.trim();
    if ((editDesc.trim() || null) !== editingItem.description)
      updates.description = editDesc.trim() || null;
    if (editRank !== editingItem.rank) updates.rank = editRank;

    // Optimistic update
    setItems((prev) =>
      prev.map((item) =>
        item.id === editingItem.id
          ? {
              ...item,
              title: editTitle.trim(),
              description: editDesc.trim() || null,
              rank: editRank,
            }
          : item
      )
    );
    setEditingItem(null);

    await fetch("/api/punch-list", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingItem.id, ...updates }),
    });
  };

  // Status counts
  const allCount = items.length;
  const statusCounts: Record<string, number> = { All: allCount };
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
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="ml-2 text-[10px] px-2 py-0.5 rounded cursor-pointer bg-[var(--accent-green)] text-white hover:opacity-90"
          >
            + Add
          </button>
          <span className="ml-auto text-xs text-[var(--text-tertiary)]">
            {loading ? "Loading..." : `${items.length} items`}
          </span>
        </div>
      )}
      {/* Add button when embedded */}
      {embedded && (
        <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] flex items-center gap-2">
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-[10px] px-2 py-0.5 rounded cursor-pointer bg-[var(--accent-green)] text-white hover:opacity-90"
          >
            + Add
          </button>
          <span className="ml-auto text-xs text-[var(--text-tertiary)]">
            {loading ? "Loading..." : `${items.length} items`}
          </span>
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] space-y-2">
          <input
            type="text"
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            placeholder="What needs fixing?"
            className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            autoFocus
          />
          <input
            type="text"
            value={addDesc}
            onChange={(e) => setAddDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-[var(--text-secondary)]">
              Rank:
            </label>
            <select
              value={addRank}
              onChange={(e) => setAddRank(parseInt(e.target.value))}
              className="text-xs px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((r) => (
                <option key={r} value={r}>
                  {r} {r <= 2 ? "(high)" : r <= 4 ? "(med)" : r <= 6 ? "(low)" : "(minor)"}
                </option>
              ))}
            </select>
            <div className="ml-auto flex gap-1.5">
              <button
                onClick={() => setShowAddForm(false)}
                className="text-[10px] px-2.5 py-1 rounded cursor-pointer bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!addTitle.trim()}
                className="text-[10px] px-2.5 py-1 rounded cursor-pointer bg-[var(--accent-green)] text-white hover:opacity-90 disabled:opacity-40"
              >
                Add Item
              </button>
            </div>
          </div>
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
                {search
                  ? "No items match your search"
                  : statusFilter === "All"
                    ? "No punch list items yet"
                    : `No ${statusFilter.toLowerCase()} items`}
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Click + Add to create one
              </p>
            </div>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="relative">
              {editingItem?.id === item.id ? (
                /* Inline edit form */
                <div className="rounded-lg border border-[var(--accent-green)] bg-[var(--bg-secondary)] p-3 space-y-2">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-green)]"
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && handleEditSave()}
                  />
                  <input
                    type="text"
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
                    onKeyDown={(e) => e.key === "Enter" && handleEditSave()}
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-[var(--text-secondary)]">
                      Rank:
                    </label>
                    <select
                      value={editRank}
                      onChange={(e) =>
                        setEditRank(parseInt(e.target.value))
                      }
                      className="text-xs px-2 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] outline-none"
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <div className="ml-auto flex gap-1.5">
                      <button
                        onClick={() => setEditingItem(null)}
                        className="text-[10px] px-2.5 py-1 rounded cursor-pointer bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleEditSave}
                        disabled={!editTitle.trim()}
                        className="text-[10px] px-2.5 py-1 rounded cursor-pointer bg-[var(--accent-green)] text-white hover:opacity-90 disabled:opacity-40"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <PunchListCard
                    item={item}
                    onToggleStatus={handleToggleStatus}
                    onDelete={handleDelete}
                    onEdit={handleEditStart}
                  />
                  {confirmDelete === item.id && (
                    <div className="absolute inset-0 bg-[var(--bg-primary)]/90 rounded-lg flex items-center justify-center gap-2">
                      <span className="text-xs text-[var(--text-secondary)]">
                        Delete?
                      </span>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 cursor-pointer"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs px-2 py-1 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
