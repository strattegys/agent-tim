"use client";

import useSWR from "swr";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type { CostSummaryResponse, UsageSummaryRow } from "@/lib/usage-event-summary-types";

async function fetchCosts(url: string): Promise<CostSummaryResponse> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error || res.statusText);
  }
  return res.json() as Promise<CostSummaryResponse>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">{value}</div>
      {sub ? <div className="text-[10px] text-[var(--text-tertiary)]">{sub}</div> : null}
    </div>
  );
}

function agentUsdRollup(rows: UsageSummaryRow[]): { agentId: string; usd: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const id = (r.agentId && r.agentId.trim()) || "—";
    map.set(id, (map.get(id) ?? 0) + (r.estimatedUsd || 0));
  }
  return [...map.entries()]
    .map(([agentId, usd]) => ({ agentId, usd }))
    .filter((x) => x.usd > 0)
    .sort((a, b) => b.usd - a.usd);
}

export default function KingDashboardPanel() {
  const visible = useDocumentVisible();

  const { data: w7, error: e7 } = useSWR<CostSummaryResponse>(
    "/api/costs/summary?days=7",
    fetchCosts,
    { refreshInterval: visible ? 120_000 : 0, revalidateOnFocus: true, dedupingInterval: 20_000 },
  );

  const { data: w30 } = useSWR<CostSummaryResponse>(
    "/api/costs/summary?days=30",
    fetchCosts,
    { refreshInterval: visible ? 120_000 : 0, revalidateOnFocus: true, dedupingInterval: 20_000 },
  );

  const totals = w7?.metered?.totals;
  const rollup = w7 ? agentUsdRollup(w7.metered.byDimension) : [];
  const maxUsd = rollup[0]?.usd ?? 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[var(--bg-primary)] px-3 py-3 space-y-3">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">King — Cost overview</h2>

      {e7 ? <p className="text-xs text-red-500">{String(e7.message)}</p> : null}

      {totals ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat
            label="Est. USD (7d)"
            value={totals.estimatedUsd.toFixed(2)}
            sub="logged usage"
          />
          <Stat label="Events (7d)" value={String(totals.events)} />
          <Stat label="Input tokens" value={totals.inputTokens.toLocaleString()} />
          <Stat label="Output tokens" value={totals.outputTokens.toLocaleString()} />
        </div>
      ) : !e7 ? (
        <p className="text-xs text-[var(--text-tertiary)]">Loading…</p>
      ) : null}

      {w30?.metered?.totals ? (
        <p className="text-[11px] text-[var(--text-secondary)] px-1">
          <span className="text-[var(--text-tertiary)]">30-day total (est.):</span>{" "}
          <strong className="tabular-nums text-[var(--text-primary)]">
            ${w30.metered.totals.estimatedUsd.toFixed(2)}
          </strong>
        </p>
      ) : null}

      {w7?.configured?.unipileMonthlyUsd != null ? (
        <p className="text-[11px] text-[var(--text-secondary)] px-1">
          <span className="text-[var(--text-tertiary)]">Configured Unipile (mo):</span> $
          {w7.configured.unipileMonthlyUsd.toFixed(2)}
        </p>
      ) : null}

      {rollup.length > 0 ? (
        <>
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] px-1">
            By agent (7d est. USD)
          </h3>
          <ul className="space-y-2">
            {rollup.map(({ agentId, usd }) => {
              const pct = maxUsd > 0 ? Math.round((usd / maxUsd) * 100) : 0;
              return (
                <li key={agentId} className="text-xs">
                  <div className="flex justify-between gap-2 mb-0.5">
                    <span className="text-[var(--text-primary)] font-medium">{agentId}</span>
                    <span className="tabular-nums text-[var(--text-secondary)]">${usd.toFixed(4)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-color)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-600/80"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : totals && totals.events === 0 ? (
        <p className="text-xs text-[var(--text-tertiary)] px-1">
          No usage in the last 7 days. Use Cost Usage for detail and sync options.
        </p>
      ) : null}

      <p className="text-[10px] text-[var(--text-tertiary)] px-1 pt-1 border-t border-[var(--border-color)]/50">
        Open <strong className="text-[var(--text-secondary)]">Cost Usage</strong> for full dimensions, refresh,
        and Anthropic sync.
      </p>
    </div>
  );
}
