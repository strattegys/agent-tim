"use client";

import { useState, useEffect, useCallback } from "react";
import ReminderCard, { type Reminder } from "./ReminderCard";
import SuziPunchListPanel from "./SuziPunchListPanel";
import SuziNotesPanel from "./SuziNotesPanel";
import { panelBus } from "@/lib/events";

type SubTab = "reminders" | "punchlist" | "notes";

const FILTERS = [
  "All",
  "Birthdays",
  "Holidays",
  "Recurring",
  "One-Time",
] as const;
type Filter = (typeof FILTERS)[number];

const TIME_FILTERS = ["Any Time", "Today", "Next 7 Days", "This Month"] as const;
type TimeFilter = (typeof TIME_FILTERS)[number];

const FILTER_TO_CATEGORY: Record<string, string | undefined> = {
  All: undefined,
  Birthdays: "birthday",
  Holidays: "holiday",
  Recurring: "recurring",
  "One-Time": "one-time",
};

/** Get "today" in Pacific time as a local Date at midnight */
function pacificToday(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parseInt(parts.find((p) => p.type === "year")!.value);
  const m = parseInt(parts.find((p) => p.type === "month")!.value) - 1;
  const d = parseInt(parts.find((p) => p.type === "day")!.value);
  return new Date(y, m, d);
}

function getTimeFilterRange(tf: TimeFilter): { start: Date; end: Date } | null {
  if (tf === "Any Time") return null;
  const start = pacificToday();
  if (tf === "Today") {
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (tf === "Next 7 Days") {
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }
  // This Month
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

interface SuziRemindersPanelProps {
  onClose: () => void;
}

export default function SuziRemindersPanel({
  onClose,
}: SuziRemindersPanelProps) {
  const [subTab, setSubTab] = useState<SubTab>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("suzi_panel_subtab");
      if (saved === "punchlist" || saved === "notes") return saved as SubTab;
    }
    return "reminders";
  });

  useEffect(() => {
    localStorage.setItem("suzi_panel_subtab", subTab);
  }, [subTab]);

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("suzi_reminder_filter");
      if (saved && FILTERS.includes(saved as Filter)) return saved as Filter;
    }
    return "All";
  });
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("suzi_reminder_time_filter");
      if (saved && TIME_FILTERS.includes(saved as TimeFilter)) return saved as TimeFilter;
    }
    return "Any Time";
  });
  const [search, setSearch] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("suzi_reminder_search") || "";
    }
    return "";
  });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Persist filter state to localStorage
  useEffect(() => { localStorage.setItem("suzi_reminder_filter", filter); }, [filter]);
  useEffect(() => { localStorage.setItem("suzi_reminder_time_filter", timeFilter); }, [timeFilter]);
  useEffect(() => { localStorage.setItem("suzi_reminder_search", search); }, [search]);

  const fetchReminders = useCallback(async () => {
    const params = new URLSearchParams({ includeInactive: "true" });
    const cat = FILTER_TO_CATEGORY[filter];
    if (cat) params.set("category", cat);
    if (search.trim()) params.set("search", search.trim());

    try {
      const res = await fetch(`/api/reminders?${params}`);
      const data = await res.json();
      setReminders(data.reminders || []);
    } catch {
      setReminders([]);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    setLoading(true);
    fetchReminders();
    const unsub = panelBus.on("reminders", fetchReminders);
    return unsub;
  }, [fetchReminders]);

  const handleToggle = async (id: string, isActive: boolean) => {
    // Optimistic update
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, isActive } : r))
    );
    await fetch("/api/reminders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isActive }),
    });
  };

  const handleDelete = async (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    // Optimistic remove
    setReminders((prev) => prev.filter((r) => r.id !== id));
    setConfirmDelete(null);
    await fetch("/api/reminders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  // Apply time filter
  const timeRange = getTimeFilterRange(timeFilter);
  const timeFiltered = timeRange
    ? reminders.filter((r) => {
        if (!r.nextDueAt) return false;
        const d = new Date(r.nextDueAt);
        return d >= timeRange.start && d <= timeRange.end;
      })
    : reminders;

  // Sort: active before inactive, then by nextDueAt
  const sorted = [...timeFiltered].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (a.nextDueAt && b.nextDueAt)
      return new Date(a.nextDueAt).getTime() - new Date(b.nextDueAt).getTime();
    if (a.nextDueAt) return -1;
    if (b.nextDueAt) return 1;
    return a.title.localeCompare(b.title);
  });

  // Category counts for pills (from time-filtered set)
  const counts: Record<string, number> = {};
  for (const r of timeFiltered) {
    counts[r.category] = (counts[r.category] || 0) + 1;
  }

  // Time filter counts (from category-filtered set, i.e. reminders)
  const timeFilterCounts: Record<string, number> = {};
  for (const tf of TIME_FILTERS) {
    const range = getTimeFilterRange(tf);
    if (!range) {
      timeFilterCounts[tf] = reminders.length;
    } else {
      timeFilterCounts[tf] = reminders.filter((r) => {
        if (!r.nextDueAt) return false;
        const d = new Date(r.nextDueAt);
        return d >= range.start && d <= range.end;
      }).length;
    }
  }

  // Helper to render the 3-tab header
  const renderSubTabHeader = () => (
    <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-1">
      {(["reminders", "punchlist", "notes"] as SubTab[]).map((tab, i) => {
        const label = tab === "punchlist" ? "Punch List" : tab === "notes" ? "Notes" : "Reminders";
        const isActive = subTab === tab;
        return (
          <span key={tab} className="contents">
            {i > 0 && <span className="text-[var(--text-tertiary)] text-[10px]">/</span>}
            <button
              onClick={() => setSubTab(tab)}
              className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
                isActive
                  ? "font-semibold text-[var(--text-primary)]"
                  : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {label}
            </button>
          </span>
        );
      })}
    </div>
  );

  if (subTab === "notes") {
    return (
      <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
        {renderSubTabHeader()}
        <SuziNotesPanel onClose={onClose} embedded />
      </div>
    );
  }

  if (subTab === "punchlist") {
    return (
      <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
        {renderSubTabHeader()}
        <SuziPunchListPanel onClose={onClose} embedded />
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      {renderSubTabHeader()}

      {/* Search */}
      <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)]">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reminders..."
          className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
        />
      </div>

      {/* Time filter pills */}
      <div className="shrink-0 px-3 py-2 flex gap-1.5 border-b border-[var(--border-color)]">
        {TIME_FILTERS.map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeFilter(tf)}
            className={`text-[10px] px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
              timeFilter === tf
                ? "bg-[var(--accent-green)] text-white font-medium"
                : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
            }`}
          >
            {tf}
            {timeFilterCounts[tf] > 0 && (
              <span className="ml-1 opacity-70">{timeFilterCounts[tf]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Category filter pills */}
      <div className="shrink-0 px-3 py-2 flex gap-1.5 flex-wrap border-b border-[var(--border-color)]">
        {FILTERS.map((f) => {
          const cat = FILTER_TO_CATEGORY[f];
          const count = cat ? counts[cat] || 0 : timeFiltered.length;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                filter === f
                  ? "bg-[#D85A30] text-white font-medium"
                  : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
              }`}
            >
              {f}
              {count > 0 && (
                <span className="ml-1 opacity-70">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Reminder list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-[var(--text-tertiary)]">
              Loading reminders...
            </p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <p className="text-sm text-[var(--text-tertiary)]">
                {search
                  ? "No reminders match your search"
                  : filter === "All"
                    ? "No reminders yet"
                    : `No ${filter.toLowerCase()} reminders`}
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Ask Suzi to add one!
              </p>
            </div>
          </div>
        ) : (
          sorted.map((r) => (
            <div key={r.id} className="relative">
              <ReminderCard
                reminder={r}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
              {confirmDelete === r.id && (
                <div className="absolute inset-0 bg-[var(--bg-primary)]/90 rounded-lg flex items-center justify-center gap-2">
                  <span className="text-xs text-[var(--text-secondary)]">
                    Delete?
                  </span>
                  <button
                    onClick={() => handleDelete(r.id)}
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
            </div>
          ))
        )}
      </div>
    </div>
  );
}
