"use client";

import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import useSWR from "swr";
import { panelBus } from "@/lib/events";
import type { PunchListItem } from "@/lib/punch-list";
import { punchListColumnLabel } from "@/lib/punch-list-columns";
import {
  punchListItemToFocusedContext,
  reminderToFocusedContext,
  type SuziFocusedIntake,
  type SuziFocusedPunchList,
  type SuziFocusedReminder,
  type SuziWorkSubTab,
} from "@/lib/suzi-work-panel";
import { wmoWeatherBrief, wmoWeatherEmoji, wmoWeatherLabel } from "@/lib/wmo-weather";
import type { Reminder } from "./ReminderCard";

const OUTLOOK_TZ = "America/Los_Angeles";

function outlookDayLabel(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const utcMid = Date.UTC(y, mo, d, 20, 0, 0);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: OUTLOOK_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(utcMid));
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include", cache: "no-store" });
  const text = await r.text();
  let data: unknown = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(r.ok ? "Unexpected response (not JSON)" : `Error ${r.status}`);
    }
  }
  if (!r.ok) {
    const err = (data as { error?: string }).error;
    throw new Error(typeof err === "string" ? err : `Error ${r.status}`);
  }
  return data as T;
}

function rowToFocusedIntake(row: Record<string, unknown>): SuziFocusedIntake {
  const n = row.itemNumber;
  const itemNumber =
    typeof n === "number" && Number.isFinite(n) && n > 0
      ? n
      : typeof n === "string" && /^\d+$/.test(n)
        ? parseInt(n, 10)
        : undefined;
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    url: row.url != null ? String(row.url) : null,
    body: row.body != null ? String(row.body) : null,
    source: typeof row.source === "string" ? row.source : "share",
    itemNumber: itemNumber && itemNumber > 0 ? itemNumber : undefined,
  };
}

function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

function sectionTitle(text: string) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] px-1">
      {text}
    </h3>
  );
}

function cardShell(children: ReactNode) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/40 p-2.5 space-y-2">
      {children}
    </div>
  );
}

export default function SuziPersonalDashboardPanel({
  onClose: _onClose,
  onNavigate,
  punchListSync,
  onFocusedIntakeChange,
  onFocusedPunchListChange,
  onFocusedReminderChange,
}: {
  onClose: () => void;
  onNavigate: (tab: SuziWorkSubTab) => void;
  punchListSync: number;
  onFocusedIntakeChange?: (item: SuziFocusedIntake | null) => void;
  onFocusedPunchListChange?: (item: SuziFocusedPunchList | null) => void;
  onFocusedReminderChange?: (item: SuziFocusedReminder | null) => void;
}) {
  const punchKey = `/api/punch-list?agentId=suzi&status=open&_=${punchListSync}`;

  const { data: weather, error: weatherErr } = useSWR(
    "/api/suzi/weather",
    (url: string) =>
      fetchJson<{
        locationLabel?: string;
        currentTempC?: number | null;
        weatherCode?: number | null;
        dailyHighC?: number | null;
        dailyLowC?: number | null;
        hourlyBuckets24h?: {
          startLabel: string;
          endLabel: string;
          weatherCode: number;
          avgTempC: number;
        }[];
        dailyOutlook?: { date: string; maxC: number; minC: number; weatherCode: number }[];
        braveWeb?: { title: string; snippet: string; url: string } | null;
        error?: string;
      }>(url)
  );

  const { data: links, error: linksErr } = useSWR(
    "/api/suzi/dashboard-links",
    (url: string) =>
      fetchJson<{
        ymca?: { scheduleUrl: string; hint: string };
        eventsSectionSubtitle?: string;
        eventLinks?: { label: string; href: string }[];
        importantLinks?: { label: string; href: string }[];
        personalLinks?: { label: string; href: string }[];
        error?: string;
      }>(url)
  );

  const { data: braveEvents, error: eventsErr } = useSWR(
    "/api/suzi/dashboard-events",
    (url: string) =>
      fetchJson<{
        results?: { title: string; url: string; snippet: string }[];
        braveUnavailable?: boolean;
        error?: string;
      }>(url)
  );

  const { data: punchData } = useSWR(punchKey, (url: string) =>
    fetchJson<{ items?: PunchListItem[] }>(url)
  );

  const { data: remindersData, mutate: mutateReminders } = useSWR(
    "/api/reminders?agentId=suzi&upcoming=true",
    (url: string) => fetchJson<{ reminders?: Reminder[] }>(url)
  );

  const { data: intakeData, mutate: mutateIntake } = useSWR(
    "/api/intake?agent=suzi&limit=8",
    (url: string) => fetchJson<{ items?: Record<string, unknown>[] }>(url)
  );

  useEffect(() => {
    const offR = panelBus.on("reminders", () => {
      void mutateReminders();
    });
    const offI = panelBus.on("intake", () => {
      void mutateIntake();
    });
    return () => {
      offR();
      offI();
    };
  }, [mutateReminders, mutateIntake]);

  const priorityPunch = useMemo(() => {
    const items = punchData?.items ?? [];
    const filtered = items.filter((i) => i.status === "open" && i.rank >= 1 && i.rank <= 3);
    return filtered
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      })
      .slice(0, 8);
  }, [punchData?.items]);

  const upcomingReminders = useMemo(() => {
    const list = remindersData?.reminders ?? [];
    return [...list]
      .filter((r) => r.isActive)
      .sort((a, b) => {
        if (!a.nextDueAt) return 1;
        if (!b.nextDueAt) return -1;
        return new Date(a.nextDueAt).getTime() - new Date(b.nextDueAt).getTime();
      })
      .slice(0, 5);
  }, [remindersData?.reminders]);

  const recentIntake = intakeData?.items ?? [];

  const openPunchItem = useCallback(
    (item: PunchListItem) => {
      onFocusedPunchListChange?.(
        punchListItemToFocusedContext(item, punchListColumnLabel(item.rank))
      );
      onNavigate("punchlist");
    },
    [onFocusedPunchListChange, onNavigate]
  );

  const openReminder = useCallback(
    (r: Reminder) => {
      onFocusedReminderChange?.(reminderToFocusedContext(r));
      onNavigate("reminders");
    },
    [onFocusedReminderChange, onNavigate]
  );

  const openIntakeRow = useCallback(
    (row: Record<string, unknown>) => {
      onFocusedIntakeChange?.(rowToFocusedIntake(row));
      onNavigate("intake");
    },
    [onFocusedIntakeChange, onNavigate]
  );

  const staticEventLinks = links?.eventLinks ?? [];
  const importantLinks = links?.importantLinks ?? [];
  const braveResults = braveEvents?.results ?? [];
  const personalLinks = links?.personalLinks ?? [];

  const currentCode =
    typeof weather?.weatherCode === "number" ? weather.weatherCode : null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-[var(--bg-primary)] px-2 sm:px-3 py-2 space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 items-start">
        <div className="min-w-0 space-y-0">
          {cardShell(
            weatherErr ? (
              <p className="text-xs text-amber-600/90">{String(weatherErr.message)}</p>
            ) : weather?.error ? (
              <p className="text-xs text-amber-600/90">{weather.error}</p>
            ) : weather ? (
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-[var(--text-primary)]">
                  {weather.locationLabel ?? "—"}
                </p>
                <div className="flex items-start gap-2">
                  {currentCode !== null ? (
                    <span
                      className="text-3xl leading-none shrink-0 select-none"
                      title={wmoWeatherLabel(currentCode)}
                      aria-hidden
                    >
                      {wmoWeatherEmoji(currentCode)}
                    </span>
                  ) : (
                    <span className="text-3xl leading-none shrink-0 opacity-40" aria-hidden>
                      🌡️
                    </span>
                  )}
                  <div className="min-w-0 space-y-0.5">
                    {typeof weather.currentTempC === "number" ? (
                      <p className="text-base font-semibold text-[var(--text-primary)] tabular-nums leading-tight">
                        {cToF(weather.currentTempC)}°F
                        <span className="text-[11px] font-normal text-[var(--text-tertiary)] ml-1">
                          ({Math.round(weather.currentTempC)}°C)
                        </span>
                      </p>
                    ) : null}
                    {currentCode !== null ? (
                      <p className="text-[10px] text-[var(--text-tertiary)] leading-snug">
                        {wmoWeatherLabel(currentCode)}
                      </p>
                    ) : null}
                    {typeof weather.dailyHighC === "number" && typeof weather.dailyLowC === "number" ? (
                      <p className="text-[10px] text-[var(--text-secondary)]">
                        Today · {cToF(weather.dailyHighC)}° / {cToF(weather.dailyLowC)}°
                      </p>
                    ) : null}
                  </div>
                </div>

                {(weather.hourlyBuckets24h?.length ?? 0) > 0 ? (
                  <div
                    className="flex flex-row gap-0.5 pt-1 justify-start"
                    role="list"
                    aria-label="Next 24 hours in 6-hour periods"
                  >
                    {weather.hourlyBuckets24h!.map((b, i) => (
                      <div
                        key={i}
                        role="listitem"
                        className="flex w-[2.65rem] shrink-0 flex-col items-center justify-center rounded border border-[var(--border-color)]/50 bg-[var(--bg-primary)]/40 py-0.5 px-0.5"
                        title={`${b.startLabel}–${b.endLabel} · ${wmoWeatherLabel(b.weatherCode)} · ${cToF(b.avgTempC)}°F`}
                      >
                        <span className="text-[7px] leading-tight text-center text-[var(--text-tertiary)] tabular-nums">
                          {b.startLabel}–{b.endLabel}
                        </span>
                        <span className="text-base leading-none select-none my-0.5" aria-hidden>
                          {wmoWeatherEmoji(b.weatherCode)}
                        </span>
                        <span className="text-[9px] font-medium tabular-nums text-[var(--text-primary)]">
                          {cToF(b.avgTempC)}°
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {(weather.dailyOutlook?.length ?? 0) > 0 ? (
                  <ul className="space-y-2 pt-0.5 border-t border-[var(--border-color)]/40 text-left">
                    {weather.dailyOutlook!.map((day) => (
                      <li key={day.date} className="space-y-0.5">
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          {outlookDayLabel(day.date)}
                        </div>
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
                          <span className="text-[11px] tabular-nums font-medium text-[var(--text-primary)]">
                            {cToF(day.maxC)}° / {cToF(day.minC)}°
                          </span>
                          {typeof day.weatherCode === "number" ? (
                            <span className="text-[10px] text-[var(--text-tertiary)] capitalize">
                              {wmoWeatherBrief(day.weatherCode)}
                            </span>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {weather.braveWeb ? (
                  <a
                    href={weather.braveWeb.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-[10px] text-[var(--text-secondary)] hover:text-[#5B8DEF] border-t border-[var(--border-color)]/60 pt-2"
                  >
                    <span className="font-medium text-[var(--text-primary)]">{weather.braveWeb.title}</span>
                    {weather.braveWeb.snippet ? (
                      <span className="block text-[var(--text-tertiary)] mt-0.5 line-clamp-2">
                        {weather.braveWeb.snippet}
                      </span>
                    ) : null}
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-tertiary)]">Loading forecast…</p>
            )
          )}
        </div>

        <div className="min-w-0 space-y-0">
          {linksErr ? (
            <p className="text-xs text-amber-600/90 px-1">{String(linksErr.message)}</p>
          ) : links ? (
            cardShell(
              <ul className="space-y-3">
                {links.ymca?.scheduleUrl ? (
                  <li>
                    <a
                      href={links.ymca.scheduleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-[#5B8DEF] hover:underline"
                    >
                      South Sound YMCA — class schedule
                    </a>
                    {links.ymca.hint ? (
                      <p className="text-[10px] text-[var(--text-tertiary)] mt-1 leading-snug">{links.ymca.hint}</p>
                    ) : null}
                  </li>
                ) : null}
                {importantLinks.map((l, i) => (
                  <li key={`imp-${l.href}-${i}`}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-[#5B8DEF] hover:underline"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
                {personalLinks.map((l, i) => (
                  <li key={`per-${l.href}-${i}`}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-[#5B8DEF] hover:underline"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
                {!links.ymca?.scheduleUrl && importantLinks.length === 0 && personalLinks.length === 0 ? (
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Add <code className="text-[10px]">ymca</code>, <code className="text-[10px]">importantLinks</code>, or{" "}
                    <code className="text-[10px]">personalLinks</code> in{" "}
                    <code className="text-[10px]">web/config/suzi-personal-dashboard.json</code>.
                  </p>
                ) : null}
              </ul>
            )
          ) : (
            <p className="text-xs text-[var(--text-tertiary)] px-1">Loading…</p>
          )}
        </div>
      </div>

      {sectionTitle("Top punch priorities")}
      {cardShell(
        priorityPunch.length === 0 ? (
          <p className="text-xs text-[var(--text-tertiary)]">No items in Now, Later, or Next.</p>
        ) : (
          <ul className="space-y-1">
            {priorityPunch.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openPunchItem(item)}
                  className="w-full text-left rounded-md px-2 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] border border-transparent hover:border-[var(--border-color)]"
                >
                  <span className="font-bold tabular-nums text-[#1D9E75] mr-1.5">#{item.itemNumber}</span>
                  <span className="text-[10px] text-[var(--text-tertiary)] mr-1">
                    {punchListColumnLabel(item.rank)}
                  </span>
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {sectionTitle("Upcoming reminders")}
      {cardShell(
        upcomingReminders.length === 0 ? (
          <p className="text-xs text-[var(--text-tertiary)]">No upcoming reminders.</p>
        ) : (
          <ul className="space-y-1">
            {upcomingReminders.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => openReminder(r)}
                  className="w-full text-left rounded-md px-2 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                >
                  <span className="font-medium">{r.title}</span>
                  {r.nextDueAt ? (
                    <span className="block text-[10px] text-[var(--text-tertiary)]">
                      {r.nextDueAt.slice(0, 10)} · {r.category}
                    </span>
                  ) : (
                    <span className="block text-[10px] text-[var(--text-tertiary)]">{r.category}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {sectionTitle("Recent intake")}
      {cardShell(
        recentIntake.length === 0 ? (
          <p className="text-xs text-[var(--text-tertiary)]">No intake items.</p>
        ) : (
          <ul className="space-y-1">
            {recentIntake.map((row, i) => {
              const id = String(row.id ?? i);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => openIntakeRow(row)}
                    className="w-full text-left rounded-md px-2 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                  >
                    {typeof row.itemNumber === "number" && row.itemNumber > 0 ? (
                      <span className="font-bold tabular-nums text-[#1D9E75] mr-1">#{row.itemNumber}</span>
                    ) : null}
                    <span className="line-clamp-2">{String(row.title ?? "")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      )}

      {sectionTitle(`Events · ${links?.eventsSectionSubtitle ?? "Local"}`)}
      {cardShell(
        eventsErr ? (
          <p className="text-xs text-amber-600/90">{String(eventsErr.message)}</p>
        ) : (
          <div className="space-y-2">
            {staticEventLinks.length > 0 ? (
              <div>
                <p className="text-[10px] text-[var(--text-tertiary)] mb-1">Saved links</p>
                <ul className="space-y-1">
                  {staticEventLinks.map((l, i) => (
                    <li key={`${l.href}-s-${i}`}>
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#5B8DEF] hover:underline"
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {braveEvents?.braveUnavailable ? (
              <p className="text-[10px] text-[var(--text-tertiary)]">
                Brave Search is not configured (<code className="text-[9px]">BRAVE_SEARCH_API_KEY</code>).
                Add curated links in{" "}
                <code className="text-[9px]">web/config/suzi-personal-dashboard.json</code>.
              </p>
            ) : null}
            {braveResults.length > 0 ? (
              <div className={staticEventLinks.length > 0 ? "border-t border-[var(--border-color)]/50 pt-2" : ""}>
                <p className="text-[10px] text-[var(--text-tertiary)] mb-1">From the web</p>
                <ul className="space-y-2">
                  {braveResults.map((h, i) => (
                    <li key={`${h.url}-${i}`}>
                      <a
                        href={h.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-[#5B8DEF] hover:underline block"
                      >
                        {h.title}
                      </a>
                      {h.snippet ? (
                        <p className="text-[10px] text-[var(--text-tertiary)] line-clamp-2 mt-0.5">
                          {h.snippet}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!braveEvents?.braveUnavailable &&
            staticEventLinks.length === 0 &&
            braveResults.length === 0 &&
            !eventsErr ? (
              <p className="text-[10px] text-[var(--text-tertiary)]">
                No results yet. Add <code className="text-[9px]">eventLinks</code> or{" "}
                <code className="text-[9px]">eventSearchQueries</code> in your dashboard JSON.
              </p>
            ) : null}
          </div>
        )
      )}
    </div>
  );
}
