"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { panelBus } from "@/lib/events";
import type { SuziFocusedIntake, SuziWorkSubTab } from "@/lib/suzi-work-panel";
import SuziPersonalDashboardPanel from "@/components/suzi/SuziPersonalDashboardPanel";
import { MobileSuziIntakeChatStrip } from "./MobileSuziIntakeChatStrip";

type SuziTab = "dashboard" | "intake" | "reminders" | "notes" | "punch";

/** SWR + manual fetches: never call `.json()` blindly (HTML login / error pages break parsing). */
async function fetchJsonRecord(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { credentials: "include", cache: "no-store" });
  const text = await r.text();
  let data: unknown = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        r.ok
          ? "Unexpected response (not JSON). Try signing in again."
          : `Request failed (${r.status})`
      );
    }
  }
  if (!r.ok) {
    const err = (data as { error?: string }).error;
    if (r.status === 401) {
      window.location.href = "/login";
      throw new Error("Unauthorized");
    }
    throw new Error(typeof err === "string" ? err : `Error ${r.status}`);
  }
  return data as Record<string, unknown>;
}

function rowToFocused(row: Record<string, unknown>): SuziFocusedIntake {
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

export function MobileSuziPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /** URL param is stripped quickly; keep “landed from Share” until we focus + scroll. */
  const shareLandingRef = useRef(false);

  const [tab, setTab] = useState<SuziTab>("dashboard");
  const [punchListSync, setPunchListSync] = useState(0);
  const [focusedIntake, setFocusedIntake] = useState<SuziFocusedIntake | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const highlightAppliedRef = useRef(false);
  const latestRef = useRef<HTMLButtonElement>(null);
  const [shareScrollTick, setShareScrollTick] = useState(0);

  const { data: intakeData, error: intakeError, mutate: mutateIntake } = useSWR(
    tab === "intake" ? "/api/intake?agent=suzi&limit=100" : null,
    fetchJsonRecord
  );
  const { data: remindersData, error: remindersError } = useSWR(
    tab === "reminders" ? "/api/reminders?agentId=suzi&upcoming=true" : null,
    fetchJsonRecord
  );
  const { data: notesData, error: notesError } = useSWR(
    tab === "notes" ? "/api/notes?agent=suzi" : null,
    fetchJsonRecord
  );
  const { data: punchData, error: punchError } = useSWR(
    tab === "punch" ? `/api/punch-list?agentId=suzi&status=open&_=${punchListSync}` : null,
    fetchJsonRecord
  );

  useEffect(() => {
    return panelBus.on("punch_list", () => {
      setPunchListSync((n) => n + 1);
    });
  }, []);

  const intakeItems = useMemo(() => {
    return (intakeData?.items as Record<string, unknown>[]) ?? [];
  }, [intakeData]);

  useLayoutEffect(() => {
    if (searchParams.get("intakeLatest") !== "1") return;
    shareLandingRef.current = true;
    setTab("intake");
    highlightAppliedRef.current = false;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("intakeLatest");
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  useEffect(() => {
    const fromShare = shareLandingRef.current;
    if (!fromShare || intakeItems.length === 0 || highlightAppliedRef.current) return;
    highlightAppliedRef.current = true;
    shareLandingRef.current = false;
    setFocusedIntake(rowToFocused(intakeItems[0]));
    setShareScrollTick((n) => n + 1);
  }, [intakeItems]);

  useEffect(() => {
    if (shareScrollTick === 0 || tab !== "intake" || intakeItems.length === 0) return;
    const t = requestAnimationFrame(() => {
      latestRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(t);
  }, [shareScrollTick, tab, intakeItems.length]);

  const appendNote = useCallback(async () => {
    if (!focusedIntake?.id || !noteDraft.trim()) return;
    setNoteSaving(true);
    setNoteErr(null);
    try {
      const block = `\n\n— Note (${new Date().toLocaleString()})\n${noteDraft.trim()}`;
      const nextBody = (focusedIntake.body?.trim() || "") + block;
      const r = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          command: "update",
          id: focusedIntake.id,
          body: nextBody,
        }),
      });
      const text = await r.text();
      let data: Record<string, unknown> = {};
      if (text.trim()) {
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          throw new Error("Bad response from server");
        }
      }
      if (!r.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Could not save note");
      }
      setNoteDraft("");
      setFocusedIntake((f) => (f ? { ...f, body: nextBody } : null));
      await mutateIntake();
      panelBus.emit("intake");
    } catch (e) {
      setNoteErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setNoteSaving(false);
    }
  }, [focusedIntake, noteDraft, mutateIntake]);

  const tabs: { key: SuziTab; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "intake", label: "Intake" },
    { key: "reminders", label: "Reminders" },
    { key: "notes", label: "Notes" },
    { key: "punch", label: "Punch" },
  ];

  const mapWorkToMobile = useCallback((t: SuziWorkSubTab): SuziTab => {
    if (t === "punchlist") return "punch";
    return t;
  }, []);

  const tabError =
    tab === "intake"
      ? intakeError
      : tab === "reminders"
        ? remindersError
        : tab === "notes"
          ? notesError
          : tab === "punch"
            ? punchError
            : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === key
                ? "bg-[#2b5278] text-white"
                : "bg-white/5 text-[#9ca3af] hover:bg-white/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tabError ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {tabError instanceof Error ? tabError.message : "Could not load data"}
        </p>
      ) : null}

      {tab === "dashboard" ? (
        <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-white/10 bg-[#0e1621]">
          <SuziPersonalDashboardPanel
            onClose={() => {}}
            onNavigate={(t) => setTab(mapWorkToMobile(t))}
            punchListSync={punchListSync}
            onFocusedIntakeChange={setFocusedIntake}
          />
        </div>
      ) : null}

      {tab === "intake" ? (
        <div className="space-y-3">
          <p className="text-[11px] leading-snug text-[#8b9bab]">
            <strong className="text-[#c4d0dc]">Share</strong> a page or link to this app (Android) to
            capture it — the URL and title are filled in automatically. Tap a row to select it, add
            notes, then chat with Suzi about that capture.
          </p>

          {focusedIntake ? (
            <div className="space-y-2 rounded-lg border border-white/10 bg-[#0e1621] p-3">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[#6b8a9e]">
                This capture
              </h3>
              {typeof focusedIntake.itemNumber === "number" && focusedIntake.itemNumber > 0 ? (
                <p className="text-[10px] font-bold tabular-nums text-[#1D9E75]">
                  #{focusedIntake.itemNumber}
                </p>
              ) : null}
              <p className="text-sm font-medium text-[#f5f5f5]">{focusedIntake.title}</p>
              {focusedIntake.url ? (
                <a
                  href={focusedIntake.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block break-all text-xs text-[#5B8DEF] underline"
                >
                  {focusedIntake.url}
                </a>
              ) : (
                <p className="text-[11px] text-[#5c6d7c]">No URL on this row</p>
              )}
              {focusedIntake.body ? (
                <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-xs text-[#b8c0c8]">
                  {focusedIntake.body}
                </p>
              ) : null}
              <div>
                <label className="block text-[10px] font-medium uppercase tracking-wide text-[#6b8a9e]">
                  Add a note (saved on this capture)
                </label>
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  rows={2}
                  className="mt-1 w-full resize-none rounded border border-white/15 bg-[#0a0f18] px-2 py-1.5 text-sm text-white placeholder:text-[#5c6d7c]"
                  placeholder="Context or instructions for Suzi…"
                />
                {noteErr ? <p className="mt-1 text-xs text-red-400">{noteErr}</p> : null}
                <button
                  type="button"
                  disabled={noteSaving || !noteDraft.trim()}
                  onClick={() => void appendNote()}
                  className="mt-2 w-full rounded-lg bg-[#2b5278] py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {noteSaving ? "Saving…" : "Save note to capture"}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[#8b9bab]">
              Tap a row in the inbox below to load its URL and notes into this screen.
            </p>
          )}

          <MobileSuziIntakeChatStrip focusedIntake={focusedIntake} />

          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6b8a9e]">Inbox</h2>
            {intakeItems.length === 0 ? (
              <p className="text-sm text-[#8b9bab]">No intake items yet. Use Share to add one.</p>
            ) : (
              <ul className="space-y-2">
                {intakeItems.map((row, i) => {
                  const id = String(row.id ?? "");
                  const focused = focusedIntake?.id === id;
                  const isNewest = i === 0;
                  return (
                    <li key={id || i}>
                      <button
                        type="button"
                        ref={isNewest ? latestRef : undefined}
                        onClick={() => setFocusedIntake(rowToFocused(row))}
                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                          focused
                            ? "border-[#1D9E75]/70 bg-[#0e1621] ring-1 ring-[#1D9E75]/50"
                            : "border-white/10 bg-[#0e1621] hover:bg-[#131b26]"
                        }`}
                      >
                        {typeof row.itemNumber === "number" && row.itemNumber > 0 ? (
                          <p className="mb-1 text-[10px] font-bold tabular-nums text-[#1D9E75]">
                            #{row.itemNumber}
                          </p>
                        ) : null}
                        <p className="font-medium text-[#f5f5f5]">{String(row.title ?? "")}</p>
                        {row.url ? (
                          <p className="mt-1 truncate text-xs text-[#5B8DEF]">{String(row.url)}</p>
                        ) : null}
                        <p className="mt-2 text-[10px] text-[#5c6d7c]">
                          {row.createdAt
                            ? String(row.createdAt).slice(0, 16).replace("T", " ")
                            : ""}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {tab === "reminders" ? (
        <ReadOnlyList
          empty="No upcoming reminders."
          rows={
            (remindersData?.reminders as Record<string, unknown>[])?.map((r) => ({
              title: String(r.title ?? "Reminder"),
              sub: [r.category, r.nextDueAt].filter(Boolean).join(" · "),
            })) ?? []
          }
        />
      ) : null}

      {tab === "notes" ? (
        <ReadOnlyList
          empty="No notes."
          rows={
            (notesData?.notes as Record<string, unknown>[])?.map((n) => ({
              title: String(n.title ?? "Note"),
              sub: n.content ? String(n.content).slice(0, 160) : "",
            })) ?? []
          }
        />
      ) : null}

      {tab === "punch" ? (
        <ReadOnlyList
          empty="No open punch items."
          rows={
            (punchData?.items as Record<string, unknown>[])?.map((p) => ({
              title: String(p.title ?? "Item"),
              sub: [p.category, `rank ${p.rank ?? ""}`].filter(Boolean).join(" · "),
            })) ?? []
          }
        />
      ) : null}
    </div>
  );
}

function ReadOnlyList({
  rows,
  empty,
}: {
  rows: { title: string; sub: string }[];
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-[#8b9bab]">{empty}</p>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i} className="rounded-lg border border-white/10 bg-[#0e1621] p-3">
          <p className="font-medium text-[#f5f5f5]">{r.title}</p>
          {r.sub ? <p className="mt-1 text-xs text-[#9ca3af]">{r.sub}</p> : null}
        </li>
      ))}
    </ul>
  );
}
