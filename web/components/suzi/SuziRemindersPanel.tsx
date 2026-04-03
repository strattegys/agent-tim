"use client";

import { useState, useEffect, useCallback } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import ReminderCard, { type Reminder } from "./ReminderCard";
import SuziPunchListPanel from "./SuziPunchListPanel";
import SuziNotesPanel from "./SuziNotesPanel";
import SuziIntakePanel from "./SuziIntakePanel";
import SuziWorkSubTabHeader from "./SuziWorkSubTabHeader";
import IntakeAddModal from "./IntakeAddModal";
import PunchListInspectSheet from "./PunchListInspectSheet";
import { panelBus } from "@/lib/events";
import type { PunchListItem } from "@/lib/punch-list";
import { punchListColumnLabel } from "@/lib/punch-list-columns";
import {
  reminderToFocusedContext,
  type SuziFocusedIntake,
  type SuziFocusedPunchList,
  type SuziFocusedReminder,
  type SuziFocusedNote,
  type SuziWorkSubTab,
  SUZI_WORK_PANEL_FALLBACK_BTN_CLASS,
} from "@/lib/suzi-work-panel";

type SubTab = SuziWorkSubTab;

/** First paint must match URL (then localStorage) so we do not call onSubTabChange("punchlist") before suziSub applies — that fought CommandCentralClient URL sync and caused suziSub to flip. */
function initialSuziPanelSubTab(searchSnapshot: string): SubTab {
  const p = new URLSearchParams(searchSnapshot).get("suziSub");
  if (p === "intake" || p === "notes" || p === "punchlist" || p === "reminders") {
    return p;
  }
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("suzi_panel_subtab");
    if (
      saved === "reminders" ||
      saved === "notes" ||
      saved === "punchlist" ||
      saved === "intake"
    ) {
      return saved as SubTab;
    }
  }
  return "punchlist";
}

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

/** Pacific calendar date YYYY-MM-DD for an instant (avoids browser-local midnight bugs). */
function formatPacificYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function ymdToDayNumber(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function reminderMatchesTimeFilter(tf: TimeFilter, nextDueAtIso: string): boolean {
  const inst = new Date(nextDueAtIso);
  if (Number.isNaN(inst.getTime())) return false;
  const rYmd = formatPacificYmd(inst);
  const rNum = ymdToDayNumber(rYmd);
  if (!Number.isFinite(rNum)) return false;

  if (tf === "Today") {
    const todayYmd = formatPacificYmd(new Date());
    return rYmd === todayYmd;
  }
  if (tf === "Next 7 Days") {
    const todayYmd = formatPacificYmd(new Date());
    const todayNum = ymdToDayNumber(todayYmd);
    if (!Number.isFinite(todayNum)) return false;
    return rNum >= todayNum && rNum <= todayNum + 7;
  }
  // This Month (Pacific)
  const todayYmd = formatPacificYmd(new Date());
  return rYmd.slice(0, 7) === todayYmd.slice(0, 7);
}

interface SuziRemindersPanelProps {
  onClose: () => void;
  /** Notifies parent whenever the work sub-tab changes (including initial mount). */
  onSubTabChange?: (tab: SubTab) => void;
  /** Highlighted Intake card for Suzi chat context (lifted to Command Central). */
  focusedIntake?: SuziFocusedIntake | null;
  onFocusedIntakeChange?: (item: SuziFocusedIntake | null) => void;
  focusedPunchList?: SuziFocusedPunchList | null;
  onFocusedPunchListChange?: (item: SuziFocusedPunchList | null) => void;
  focusedReminder?: SuziFocusedReminder | null;
  onFocusedReminderChange?: (item: SuziFocusedReminder | null) => void;
  focusedNote?: SuziFocusedNote | null;
  onFocusedNoteChange?: (item: SuziFocusedNote | null) => void;
}

export default function SuziRemindersPanel({
  onClose,
  onSubTabChange,
  focusedIntake,
  onFocusedIntakeChange,
  focusedPunchList,
  onFocusedPunchListChange,
  focusedReminder,
  onFocusedReminderChange,
  focusedNote,
  onFocusedNoteChange,
}: SuziRemindersPanelProps) {
  const searchParams = useSearchParams();

  const [subTab, setSubTab] = useState<SubTab>(() =>
    initialSuziPanelSubTab(searchParams.toString())
  );
  const [intakeAddOpen, setIntakeAddOpen] = useState(false);
  const [punchInspectItem, setPunchInspectItem] = useState<PunchListItem | null>(null);
  /** Bumped on every `punch_list` bus event so the punch list refetches after Suzi tools (panel may be unmounted on other tabs). */
  const [punchListSync, setPunchListSync] = useState(0);

  const suziSubParam = searchParams.get("suziSub");
  useEffect(() => {
    if (
      suziSubParam === "intake" ||
      suziSubParam === "notes" ||
      suziSubParam === "punchlist" ||
      suziSubParam === "reminders"
    ) {
      setSubTab(suziSubParam as SubTab);
      return;
    }
    const saved = localStorage.getItem("suzi_panel_subtab");
    if (
      saved === "reminders" ||
      saved === "notes" ||
      saved === "punchlist" ||
      saved === "intake"
    ) {
      setSubTab(saved as SubTab);
    }
  }, [suziSubParam]);

  useEffect(() => {
    localStorage.setItem("suzi_panel_subtab", subTab);
  }, [subTab]);

  useEffect(() => {
    onSubTabChange?.(subTab);
  }, [subTab, onSubTabChange]);

  useEffect(() => {
    if (subTab !== "punchlist") setPunchInspectItem(null);
  }, [subTab]);

  useEffect(() => {
    return panelBus.on("punch_list", () => {
      setPunchListSync((n) => n + 1);
    });
  }, []);

  const [filter, setFilter] = useState<Filter>("All");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("Any Time");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const sf = localStorage.getItem("suzi_reminder_filter");
    if (sf && FILTERS.includes(sf as Filter)) setFilter(sf as Filter);
    const tf = localStorage.getItem("suzi_reminder_time_filter");
    if (tf && TIME_FILTERS.includes(tf as TimeFilter)) setTimeFilter(tf as TimeFilter);
    const s = localStorage.getItem("suzi_reminder_search");
    if (s) {
      setSearch(s);
      setDebouncedSearch(s.trim());
    }
    if (localStorage.getItem("suzi_reminder_show_inactive") === "1") {
      setShowInactive(true);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => { localStorage.setItem("suzi_reminder_filter", filter); }, [filter]);
  useEffect(() => { localStorage.setItem("suzi_reminder_time_filter", timeFilter); }, [timeFilter]);
  useEffect(() => { localStorage.setItem("suzi_reminder_search", search); }, [search]);
  useEffect(() => {
    localStorage.setItem("suzi_reminder_show_inactive", showInactive ? "1" : "0");
  }, [showInactive]);

  const reminderSwrKey = subTab === "reminders"
    ? (() => {
        const params = new URLSearchParams();
        if (showInactive) params.set("includeInactive", "true");
        const cat = FILTER_TO_CATEGORY[filter];
        if (cat) params.set("category", cat);
        if (debouncedSearch) params.set("search", debouncedSearch);
        return `/api/reminders?${params}`;
      })()
    : null;

  const {
    data: remindersData,
    isLoading: loading,
    mutate: refreshReminders,
  } = useSWR<{ reminders: Reminder[] }>(
    reminderSwrKey,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    { revalidateOnFocus: true, dedupingInterval: 10_000 },
  );

  const reminders = remindersData?.reminders ?? [];

  useEffect(() => {
    if (subTab !== "reminders") return undefined;
    return panelBus.on("reminders", () => void refreshReminders());
  }, [subTab, refreshReminders]);

  const handleToggle = async (id: string, isActive: boolean) => {
    await refreshReminders(
      (prev) =>
        prev
          ? { reminders: prev.reminders.map((r) => (r.id === id ? { ...r, isActive } : r)) }
          : prev,
      false,
    );
    await fetch("/api/reminders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isActive }),
    });
    void refreshReminders();
  };

  const toggleSuziFocusReminder = useCallback(
    (r: Reminder) => {
      if (!onFocusedReminderChange) return;
      if (focusedReminder?.id === r.id) onFocusedReminderChange(null);
      else onFocusedReminderChange(reminderToFocusedContext(r));
    },
    [focusedReminder?.id, onFocusedReminderChange]
  );

  const handleBulkRemoveInactive = async () => {
    if (
      !confirm(
        "Remove every inactive reminder from the database? This cannot be undone (rows are archived, not permanently deleted)."
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "softDeleteInactive", agentId: "suzi" }),
      });
      const data = (await res.json()) as { removed?: number; error?: string };
      if (!res.ok) {
        console.warn("[SuziReminders] bulk inactive:", data.error);
        return;
      }
      panelBus.emit("reminders");
      await refreshReminders();
    } finally {
      setBulkBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    if (onFocusedReminderChange && focusedReminder?.id === id) {
      onFocusedReminderChange(null);
    }
    setConfirmDelete(null);
    await refreshReminders(
      (prev) => (prev ? { reminders: prev.reminders.filter((r) => r.id !== id) } : prev),
      false,
    );
    await fetch("/api/reminders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    void refreshReminders();
  };

  // Apply time filter (Pacific calendar — matches CRM / Govind expectations)
  const timeFiltered =
    timeFilter === "Any Time"
      ? reminders
      : reminders.filter(
          (r) => r.nextDueAt && reminderMatchesTimeFilter(timeFilter, r.nextDueAt)
        );

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
    if (tf === "Any Time") {
      timeFilterCounts[tf] = reminders.length;
    } else {
      timeFilterCounts[tf] = reminders.filter(
        (r) => r.nextDueAt && reminderMatchesTimeFilter(tf, r.nextDueAt)
      ).length;
    }
  }

  const inactiveCountInDb = reminders.filter((r) => !r.isActive).length;

  const subTabHeaderFallback =
    subTab === "intake" ? (
      <button
        type="button"
        onClick={() => setIntakeAddOpen(true)}
        title="Add a capture to Intake"
        className={SUZI_WORK_PANEL_FALLBACK_BTN_CLASS}
      >
        Add Intake
      </button>
    ) : undefined;

  const renderSubTabHeader = () => (
    <SuziWorkSubTabHeader
      subTab={subTab}
      onSubTabChange={setSubTab}
      fallbackAction={subTabHeaderFallback}
    />
  );

  if (subTab === "notes") {
    return (
      <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
        {renderSubTabHeader()}
        <SuziNotesPanel
          onClose={onClose}
          embedded
          focusedNoteId={focusedNote?.id ?? null}
          onFocusedNoteChange={onFocusedNoteChange}
        />
      </div>
    );
  }

  if (subTab === "intake") {
    return (
      <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
        {renderSubTabHeader()}
        <IntakeAddModal open={intakeAddOpen} onClose={() => setIntakeAddOpen(false)} />
        <SuziIntakePanel
          onClose={onClose}
          embedded
          focusedIntakeId={focusedIntake?.id ?? null}
          onFocusedIntakeChange={onFocusedIntakeChange}
        />
      </div>
    );
  }

  if (subTab === "punchlist") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary)] min-w-0">
        {renderSubTabHeader()}
        {/* Inspect sheet: fixed 90% height of this pane (below sub-tab header), not the tab row */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden min-w-0">
          <SuziPunchListPanel
            onClose={onClose}
            embedded
            focusedPunchListId={focusedPunchList?.id ?? null}
            onFocusedPunchListChange={onFocusedPunchListChange}
            inspectItem={punchInspectItem}
            onInspectItemChange={setPunchInspectItem}
            punchListSync={punchListSync}
          />
          {punchInspectItem && (
            <PunchListInspectSheet
              item={punchInspectItem}
              columnLabel={punchListColumnLabel(punchInspectItem.rank)}
              onClose={() => setPunchInspectItem(null)}
              isFocusedForSuzi={focusedPunchList?.id === punchInspectItem.id}
              onClearSuziFocus={() => onFocusedPunchListChange?.(null)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      {renderSubTabHeader()}

      {/* Search + inactive toggle */}
      <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] space-y-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reminders..."
          className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
        />
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-[var(--text-secondary)]">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-[var(--border-color)]"
            />
            Show inactive
          </label>
          {showInactive && inactiveCountInDb > 0 ? (
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void handleBulkRemoveInactive()}
              className="text-[10px] px-2 py-0.5 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            >
              {bulkBusy ? "…" : `Remove all ${inactiveCountInDb} inactive`}
            </button>
          ) : null}
        </div>
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
                isFocused={focusedReminder?.id === r.id}
                onToggleSuziFocus={
                  onFocusedReminderChange
                    ? () => toggleSuziFocusReminder(r)
                    : undefined
                }
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
