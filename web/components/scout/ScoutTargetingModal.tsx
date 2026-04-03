"use client";

import { useState, useEffect, useRef } from "react";
import type { ScoutSourceRef, ScoutTargetingSpec } from "@/lib/package-types";

interface ScoutTargetingModalProps {
  packageId: string;
  packageName: string;
  initial: ScoutTargetingSpec | null;
  onClose: () => void;
  onSaved: () => void;
}

function sourcesToLines(sources: ScoutSourceRef[] | undefined): string {
  if (!sources?.length) return "";
  return sources
    .map((s) => {
      const label = s.label ? `${s.label}`.replace(/\|/g, " ") : "";
      return label ? `${s.type}|${label}|${s.detail || ""}` : `${s.type}|${s.detail || ""}`;
    })
    .join("\n");
}

function linesToSources(text: string): ScoutSourceRef[] {
  const out: ScoutSourceRef[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split("|").map((p) => p.trim());
    if (parts.length >= 3) {
      out.push({ type: parts[0], label: parts[1] || undefined, detail: parts.slice(2).join("|") || undefined });
    } else if (parts.length === 2) {
      out.push({ type: parts[0], detail: parts[1] || undefined });
    } else {
      out.push({ type: parts[0] });
    }
  }
  return out;
}

export default function ScoutTargetingModal({
  packageId,
  packageName,
  initial,
  onClose,
  onSaved,
}: ScoutTargetingModalProps) {
  const [dailyGoal, setDailyGoal] = useState(
    initial?.dailyNewTargetsGoal != null ? String(initial.dailyNewTargetsGoal) : ""
  );
  const [icpSummary, setIcpSummary] = useState(initial?.icpSummary ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [titlePatterns, setTitlePatterns] = useState((initial?.titlePatterns ?? []).join(", "));
  const [keywords, setKeywords] = useState((initial?.keywords ?? []).join(", "));
  const [excludeKeywords, setExcludeKeywords] = useState((initial?.excludeKeywords ?? []).join(", "));
  const [sourcesLines, setSourcesLines] = useState(sourcesToLines(initial?.sources));
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const splitComma = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  const handleSave = async () => {
    setSaving(true);
    try {
      const dailyNum = dailyGoal.trim() === "" ? undefined : Number(dailyGoal);
      const scoutTargeting: ScoutTargetingSpec = {};
      if (dailyNum != null && !Number.isNaN(dailyNum) && dailyNum >= 0) {
        scoutTargeting.dailyNewTargetsGoal = Math.round(dailyNum);
      }
      if (icpSummary.trim()) scoutTargeting.icpSummary = icpSummary.trim();
      if (notes.trim()) scoutTargeting.notes = notes.trim();
      const tp = splitComma(titlePatterns);
      if (tp.length) scoutTargeting.titlePatterns = tp;
      const kw = splitComma(keywords);
      if (kw.length) scoutTargeting.keywords = kw;
      const ex = splitComma(excludeKeywords);
      if (ex.length) scoutTargeting.excludeKeywords = ex;
      const src = linesToSources(sourcesLines);
      if (src.length) scoutTargeting.sources = src;

      const res = await fetch("/api/crm/packages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: packageId,
          spec: { scoutTargeting },
        }),
      });
      if (res.ok) {
        onSaved();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-[92vw] max-w-[560px] max-h-[88vh] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-4 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Scout targeting</h2>
            <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">{packageName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 text-[13px]">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">
              Daily new targets (goal)
            </span>
            <input
              ref={firstRef}
              type="number"
              min={0}
              className="mt-1 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)]"
              value={dailyGoal}
              onChange={(e) => setDailyGoal(e.target.value)}
              placeholder="e.g. 10"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">ICP (one line)</span>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)]"
              value={icpSummary}
              onChange={(e) => setIcpSummary(e.target.value)}
              placeholder="e.g. VP Eng at Series B+ AI infra startups, US/EU"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">Notes for Scout</span>
            <textarea
              className="mt-1 w-full min-h-[72px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)] resize-y"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Signals to prefer, accounts to avoid, messaging hooks…"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">
              Title patterns (comma-separated)
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)]"
              value={titlePatterns}
              onChange={(e) => setTitlePatterns(e.target.value)}
              placeholder="VP Engineering, Head of ML, …"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">
              Keywords (comma-separated)
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)]"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">
              Exclude keywords
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)]"
              value={excludeKeywords}
              onChange={(e) => setExcludeKeywords(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">
              Sources (one per line: type|detail or type|label|detail)
            </span>
            <textarea
              className="mt-1 w-full min-h-[80px] font-mono text-[12px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)] resize-y"
              value={sourcesLines}
              onChange={(e) => setSourcesLines(e.target.value)}
              placeholder={"unipile_followers_of|influencer-public-slug\nrss|https://…"}
            />
          </label>
        </div>

        <div className="shrink-0 px-4 py-3 border-t border-[var(--border-color)] flex justify-end gap-2 bg-[var(--bg-secondary)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-[13px] border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg text-[13px] bg-[#2563EB] text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
