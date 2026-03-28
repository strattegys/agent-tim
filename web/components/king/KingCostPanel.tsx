"use client";

import { useCallback, useEffect, useState } from "react";
import type { CostSummaryResponse } from "@/lib/usage-event-summary-types";

/** Work tabs inside King’s work panel — extend when adding surfaces (e.g. invoices). */
export type KingWorkTab = "cost-usage";

export default function KingCostPanel() {
  const [workTab, setWorkTab] = useState<KingWorkTab>("cost-usage");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<CostSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - days);
    try {
      const res = await fetch(
        `/api/costs/summary?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || res.statusText);
      }
      setData((await res.json()) as CostSummaryResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAnthropicSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/costs/sync-anthropic", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 10 }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        rows?: number;
        detail?: string;
      };
      if (!res.ok) {
        setSyncMsg(j.detail || "Sync failed");
        return;
      }
      setSyncMsg(`Synced ${j.rows ?? 0} cost row(s). Refreshing…`);
      await load();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col min-h-0 flex-1 bg-[var(--bg-secondary)]">
      {/* Work tabs (same level as Tim / Suzi sub-nav) */}
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
        <button
          type="button"
          onClick={() => setWorkTab("cost-usage")}
          className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
            workTab === "cost-usage"
              ? "font-semibold text-[var(--text-primary)]"
              : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          }`}
        >
          Cost-Usage
        </button>
      </div>

      {/* Active tab: toolbar + content (additional tabs render their own blocks here) */}
      {workTab === "cost-usage" && (
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
            <label className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
              Days
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-1 py-0.5 text-[var(--text-primary)]"
              >
                {[7, 14, 30, 90].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="text-[10px] px-2 py-1 rounded border border-[var(--border-color)] hover:bg-[var(--bg-primary)] disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void runAnthropicSync()}
              disabled={syncing}
              className="text-[10px] px-2 py-1 rounded border border-[var(--border-color)] hover:bg-[var(--bg-primary)] disabled:opacity-50"
              title="Requires ANTHROPIC_ADMIN_API_KEY on server"
            >
              {syncing ? "Syncing…" : "Sync Anthropic"}
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto p-3 text-sm text-[var(--text-primary)]">
        {loading && <p className="text-[var(--text-tertiary)] text-xs">Loading…</p>}
        {error && (
          <p className="text-red-400 text-xs mb-2">{error}</p>
        )}
        {syncMsg && (
          <p className="text-[var(--text-secondary)] text-xs mb-2">{syncMsg}</p>
        )}
        {data && !loading && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
              <Stat label="Events" value={String(data.metered.totals.events)} />
              <Stat
                label="Input tokens"
                value={data.metered.totals.inputTokens.toLocaleString()}
              />
              <Stat
                label="Output tokens"
                value={data.metered.totals.outputTokens.toLocaleString()}
              />
              <Stat
                label="TTS chars"
                value={data.metered.totals.ttsCharacters.toLocaleString()}
              />
              <Stat
                label="Est. USD (logged)"
                value={data.metered.totals.estimatedUsd.toFixed(4)}
              />
              {data.configured.unipileMonthlyUsd != null && (
                <Stat
                  label="Unipile (mo)"
                  value={`$${data.configured.unipileMonthlyUsd.toFixed(2)}`}
                />
              )}
            </div>
            <p className="text-[10px] text-[var(--text-tertiary)] mb-2">
              {data.configured.notes}
            </p>
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-1">
              By dimension
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="text-left text-[var(--text-tertiary)] border-b border-[var(--border-color)]">
                    <th className="py-1 pr-2">App</th>
                    <th className="py-1 pr-2">Surface</th>
                    <th className="py-1 pr-2">Provider</th>
                    <th className="py-1 pr-2">Agent</th>
                    <th className="py-1 pr-2 text-right">Ev</th>
                    <th className="py-1 pr-2 text-right">In</th>
                    <th className="py-1 pr-2 text-right">Out</th>
                    <th className="py-1 pr-2 text-right">TTS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.metered.byDimension.map((r, i) => (
                    <tr
                      key={`${r.application}-${r.surface}-${r.provider}-${r.agentId}-${i}`}
                      className="border-b border-[var(--border-color)]/60"
                    >
                      <td className="py-1 pr-2 font-mono">{r.application}</td>
                      <td className="py-1 pr-2">{r.surface}</td>
                      <td className="py-1 pr-2">{r.provider}</td>
                      <td className="py-1 pr-2">{r.agentId ?? "—"}</td>
                      <td className="py-1 pr-2 text-right">{r.events}</td>
                      <td className="py-1 pr-2 text-right">{r.inputTokens}</td>
                      <td className="py-1 pr-2 text-right">{r.outputTokens}</td>
                      <td className="py-1 pr-2 text-right">{r.ttsCharacters}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.metered.byDimension.length === 0 && (
              <p className="text-[var(--text-tertiary)] text-xs mt-2">
                No rows in range. Use CRM DB with migrate-usage-events.sql, or dev
                JSONL at web/.dev-store/usage_events.jsonl.
              </p>
            )}
          </>
        )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}
