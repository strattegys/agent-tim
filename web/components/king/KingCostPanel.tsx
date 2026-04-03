"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import type { AgentConfig } from "@/lib/agent-frontend";
import KingDashboardPanel from "./KingDashboardPanel";
import type {
  CostSummaryResponse,
  UsageWarehouseCoverage,
} from "@/lib/usage-event-summary-types";

/** Work tabs inside King’s work panel — Dashboard first (like Suzi), then Cost Usage. */
export type KingWorkTab = "dashboard" | "cost-usage";

/** Hours between warehouse min and max occurredAt (null if unknown). */
function warehouseSpanHours(coverage: {
  oldestOccurredAt: string | null;
  newestOccurredAt: string | null;
}): number | null {
  const { oldestOccurredAt: a, newestOccurredAt: b } = coverage;
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 3_600_000;
}

function KingWarehouseCoverage({ coverage }: { coverage: UsageWarehouseCoverage }) {
  const spanH = warehouseSpanHours(coverage);
  const thinHistory = spanH != null && spanH <= 48;
  return (
    <div className="text-[10px] text-[var(--text-secondary)] mb-3 space-y-1 border border-[var(--border-color)] rounded px-2 py-1.5 bg-[var(--bg-primary)]">
      <p className="font-mono break-all">
        Warehouse (all stored rows): {coverage.totalRows.toLocaleString()} events; oldest{" "}
        {coverage.oldestOccurredAt?.slice(0, 19) ?? "—"}Z → newest{" "}
        {coverage.newestOccurredAt?.slice(0, 19) ?? "—"}Z UTC
      </p>
      {thinHistory && spanH != null && (
        <p className="text-[var(--text-tertiary)]">
          Stored history spans only about {spanH.toFixed(1)} hours — wider &quot;Days&quot; presets
          can match each other because everything already falls in-range.
        </p>
      )}
      <p className="text-[var(--text-tertiary)]">
        Tim metered LLM usage is mostly automation (LinkedIn inbound triage, webhooks, cron), not
        how often you chat with Tim in the UI.
      </p>
    </div>
  );
}

export default function KingCostPanel({ agent: _agent }: { agent: AgentConfig }) {
  const [workTab, setWorkTab] = useState<KingWorkTab>("dashboard");
  const [days, setDays] = useState(30);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const { data: data = null, error: swrError, isLoading: loading, mutate: refreshCosts } = useSWR<CostSummaryResponse>(
    `/api/costs/summary?days=${days}`,
    async (url: string) => {
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || res.statusText);
      }
      return res.json() as Promise<CostSummaryResponse>;
    },
    { revalidateOnFocus: true, dedupingInterval: 15_000 },
  );

  const error = swrError ? (swrError instanceof Error ? swrError.message : "Failed to load") : null;

  const requestRefresh = useCallback(() => {
    void refreshCosts();
  }, [refreshCosts]);

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
      requestRefresh();
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
          onClick={() => setWorkTab("dashboard")}
          className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
            workTab === "dashboard"
              ? "font-semibold text-[var(--text-primary)]"
              : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          }`}
        >
          Dashboard
        </button>
        <button
          type="button"
          onClick={() => setWorkTab("cost-usage")}
          className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
            workTab === "cost-usage"
              ? "font-semibold text-[var(--text-primary)]"
              : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          }`}
        >
          Cost Usage
        </button>
      </div>

      {workTab === "dashboard" && <KingDashboardPanel />}

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
                {(
                  [
                    [1, "1 day"],
                    [3, "3 days"],
                    [7, "7 days"],
                    [14, "14 days"],
                    [30, "30 days"],
                    [90, "90 days"],
                  ] as const
                ).map(([d, label]) => (
                  <option key={d} value={d}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => requestRefresh()}
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
            <p className="text-[10px] text-[var(--text-tertiary)] mb-3 font-mono break-all">
              Range (UTC): {data.from.slice(0, 19)}Z → {data.to.slice(0, 19)}Z — same window
              for stats and table.
            </p>
            {data.coverage ? <KingWarehouseCoverage coverage={data.coverage} /> : null}
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
              By dimension (In+Out+TTS first, then events)
            </h3>
            <p className="text-[9px] text-[var(--text-tertiary)] mb-1">
              Integration rows can have many Ev with 0 In/Out; LLM usage sorts to the top when tokens
              exist in range.
            </p>
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
                  {data.metered.byDimension.map((r) => (
                    <tr
                      key={[
                        r.application,
                        r.surface,
                        r.provider,
                        r.model ?? "",
                        r.agentId ?? "",
                      ].join("|")}
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
