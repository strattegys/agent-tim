"use client";

import useSWR from "swr";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type { ScoutQueueResponse } from "@/lib/scout-queue";

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(`Error ${r.status}`);
  return r.json() as Promise<T>;
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">{value}</div>
      {sub ? <div className="text-[10px] text-[var(--text-tertiary)]">{sub}</div> : null}
    </div>
  );
}

export default function ScoutDashboardPanel() {
  const visible = useDocumentVisible();

  const { data, error, isLoading } = useSWR<ScoutQueueResponse>(
    "/api/crm/scout-queue",
    fetchJson,
    { refreshInterval: visible ? 90_000 : 0, revalidateOnFocus: true, dedupingInterval: 15_000 },
  );

  const s = data?.summary;
  const pacePct =
    s && s.totalEffectiveDailyGoal > 0
      ? Math.min(100, Math.round((s.totalItemsCreatedLast24h / s.totalEffectiveDailyGoal) * 100))
      : null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[var(--bg-primary)] px-3 py-3 space-y-3">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">Scout — Research overview</h2>

      {isLoading && !data ? (
        <p className="text-xs text-[var(--text-tertiary)]">Loading…</p>
      ) : null}
      {error ? (
        <p className="text-xs text-red-500">Could not load Scout queue.</p>
      ) : null}

      {s ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Campaigns" value={s.campaignCount} sub="active packages" />
            <Stat label="In pipeline" value={s.totalInPipeline} sub="items" />
            <Stat label="Handed off" value={s.totalHandedOff} sub="all time" />
            <Stat label="New (24h)" value={s.totalItemsCreatedLast24h} sub="items created" />
          </div>

          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/40 p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              Daily goal pace
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              Sum of effective daily goals:{" "}
              <strong className="text-[var(--text-primary)]">{s.totalEffectiveDailyGoal}</strong>/day
            </p>
            {pacePct != null ? (
              <>
                <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden border border-[var(--border-color)]">
                  <div
                    className="h-full rounded-full bg-[#2563EB] transition-all"
                    style={{ width: `${pacePct}%` }}
                  />
                </div>
                <p className="text-[10px] text-[var(--text-tertiary)]">
                  Last 24h vs sum of goals: {pacePct}%
                  {s.totalEffectiveDailyGoal > 0 && s.totalItemsCreatedLast24h >= s.totalEffectiveDailyGoal
                    ? " · on or above pace"
                    : s.totalEffectiveDailyGoal > 0
                      ? " · below combined goal"
                      : ""}
                </p>
              </>
            ) : null}
          </div>

          {(data?.campaigns?.length ?? 0) > 0 ? (
            <>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] px-1">
                Campaigns
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {data!.campaigns.slice(0, 6).map((c) => (
                  <div
                    key={c.workflowId}
                    className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2.5"
                  >
                    <p className="text-xs font-semibold text-[var(--text-primary)] line-clamp-1">
                      {c.packageName}
                    </p>
                    <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                      {c.progressPercent}% to target · {c.handedOffCount}
                      {c.targetCount > 0 ? ` / ${c.targetCount}` : ""} handed off
                    </p>
                    {c.effectiveDailyGoal > 0 ? (
                      <p className="text-[10px] text-[var(--text-secondary)] mt-1">
                        Goal {c.effectiveDailyGoal}/day · +{c.itemsCreatedLast24h} last 24h
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
              {(data?.campaigns?.length ?? 0) > 6 ? (
                <p className="text-[10px] text-[var(--text-tertiary)] px-1">
                  +{data!.campaigns.length - 6} more on Campaign Throughput tab
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-[var(--text-tertiary)]">
              No active Scout campaigns. Activate a package with a research pipeline owned by Scout.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
