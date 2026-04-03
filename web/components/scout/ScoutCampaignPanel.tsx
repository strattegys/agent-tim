"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import ScoutTargetingModal from "@/components/scout/ScoutTargetingModal";
import { panelBus } from "@/lib/events";
import type { ScoutQueueCampaign, ScoutQueueResponse } from "@/lib/scout-queue";

const KanbanInlinePanel = dynamic(() => import("@/components/kanban/KanbanInlinePanel"), {
  ssr: false,
  loading: () => (
    <div className="text-[12px] text-[var(--text-tertiary)] p-4">Loading board…</div>
  ),
});

interface ScoutCampaignPanelProps {
  onClose: () => void;
}

const STAGE_ORDER = ["FINDING", "ENRICHING", "QUALIFICATION", "HANDED_OFF", "REJECTED"] as const;

function stageLabel(key: string): string {
  switch (key) {
    case "FINDING":
      return "Finding";
    case "ENRICHING":
      return "Enriching";
    case "QUALIFICATION":
      return "Qualification";
    case "HANDED_OFF":
      return "Handed off";
    case "REJECTED":
      return "Rejected";
    default:
      return key;
  }
}

function FunnelBar({ c }: { c: ScoutQueueCampaign }) {
  const total = Math.max(
    1,
    STAGE_ORDER.reduce((s, k) => s + (c.stageCounts[k] || 0), 0)
  );
  return (
    <div className="mt-2">
      <div className="flex h-2 rounded-full overflow-hidden bg-[var(--bg-secondary)] border border-[var(--border-color)]">
        {STAGE_ORDER.map((k) => {
          const n = c.stageCounts[k] || 0;
          if (n === 0) return null;
          const pct = (n / total) * 100;
          const color =
            k === "HANDED_OFF"
              ? "#9B59B6"
              : k === "REJECTED"
                ? "#DC2626"
                : k === "QUALIFICATION"
                  ? "#16A34A"
                  : k === "ENRICHING"
                    ? "#2563EB"
                    : "#6b8a9e";
          return (
            <div
              key={k}
              style={{ width: `${pct}%`, backgroundColor: color }}
              title={`${stageLabel(k)}: ${n}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-[var(--text-tertiary)]">
        {STAGE_ORDER.map((k) => {
          const n = c.stageCounts[k] || 0;
          return (
            <span key={k}>
              {stageLabel(k)} {n}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function ScoutCampaignPanel({ onClose }: ScoutCampaignPanelProps) {
  const [data, setData] = useState<ScoutQueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [kanbanWorkflowId, setKanbanWorkflowId] = useState<string | null>(null);
  const [kanbanLabel, setKanbanLabel] = useState("");
  const [targetingCampaign, setTargetingCampaign] = useState<ScoutQueueCampaign | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/crm/scout-queue", { cache: "no-store" });
      if (!res.ok) {
        setError("Could not load Scout queue");
        setData(null);
        return;
      }
      const json = (await res.json()) as ScoutQueueResponse;
      setData(json);
    } catch {
      setError("Could not load Scout queue");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const u1 = panelBus.on("workflow_items", load);
    const u2 = panelBus.on("twenty_crm", load);
    const u3 = panelBus.on("dashboard_sync", load);
    return () => {
      u1();
      u2();
      u3();
    };
  }, [load]);

  if (kanbanWorkflowId) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-[var(--bg-secondary)]">
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)]">
          <button
            type="button"
            onClick={() => setKanbanWorkflowId(null)}
            className="text-[12px] text-[#2563EB] hover:underline"
          >
            ← Campaign queue
          </button>
          <span className="text-[11px] text-[var(--text-tertiary)] truncate">{kanbanLabel}</span>
        </div>
        <div className="flex-1 min-h-0">
          <KanbanInlinePanel
            onClose={() => setKanbanWorkflowId(null)}
            agentId="scout"
            fixedWorkflowId={kanbanWorkflowId}
            fixedWorkflowLabel={kanbanLabel}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg-secondary)]">
      <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Campaign throughput</h2>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
            Active packages with Scout research pipelines — pace vs handoffs
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] shrink-0"
        >
          Close
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {loading && (
          <p className="text-[12px] text-[var(--text-tertiary)]">Loading campaigns…</p>
        )}
        {error && <p className="text-[12px] text-red-400">{error}</p>}
        {!loading && data && data.summary.campaignCount === 0 && (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 text-[12px] text-[var(--text-secondary)]">
            <p className="font-medium text-[var(--text-primary)]">No active Scout campaigns</p>
            <p className="mt-2 text-[var(--text-tertiary)]">
              Activate a package that includes a <strong>research-pipeline</strong> workflow owned by{" "}
              <strong>scout</strong>. Cards appear here with targets, funnel counts, and daily goals.
            </p>
          </div>
        )}
        {data && data.summary.campaignCount > 0 && (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-[11px] text-[var(--text-secondary)]">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>
                <strong className="text-[var(--text-primary)]">{data.summary.campaignCount}</strong> campaigns
              </span>
              <span>
                Sum of daily goals:{" "}
                <strong className="text-[var(--text-primary)]">{data.summary.totalEffectiveDailyGoal}</strong>
                /day
              </span>
              <span>
                New items (24h):{" "}
                <strong className="text-[var(--text-primary)]">{data.summary.totalItemsCreatedLast24h}</strong>
              </span>
              <span>
                In pipeline:{" "}
                <strong className="text-[var(--text-primary)]">{data.summary.totalInPipeline}</strong>
              </span>
              <span>
                Handed off (total):{" "}
                <strong className="text-[var(--text-primary)]">{data.summary.totalHandedOff}</strong>
              </span>
            </div>
          </div>
        )}

        {data?.campaigns.map((c) => (
          <article
            key={c.workflowId}
            className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                  {c.packageName}
                </h3>
                <p className="text-[11px] text-[var(--text-tertiary)] truncate">
                  {c.deliverableLabel || c.workflowName}
                  {c.volumeLabel ? ` · ${c.volumeLabel}` : ""}
                </p>
                {c.scoutTargeting?.icpSummary && (
                  <p className="text-[11px] text-[var(--text-secondary)] mt-1 line-clamp-2">
                    {c.scoutTargeting.icpSummary}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-[18px] font-bold text-[#2563EB] leading-tight">
                  {c.progressPercent}%
                </div>
                <div className="text-[10px] text-[var(--text-tertiary)]">to target</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg bg-[var(--bg-secondary)] px-2 py-1.5 border border-[var(--border-color)]">
                <div className="text-[var(--text-tertiary)]">Target (handoffs)</div>
                <div className="text-[var(--text-primary)] font-medium">
                  {c.handedOffCount}
                  {c.targetCount > 0 ? ` / ${c.targetCount}` : ""}
                </div>
              </div>
              <div className="rounded-lg bg-[var(--bg-secondary)] px-2 py-1.5 border border-[var(--border-color)]">
                <div className="text-[var(--text-tertiary)]">Daily goal</div>
                <div className="text-[var(--text-primary)] font-medium">
                  {c.effectiveDailyGoal > 0 ? `${c.effectiveDailyGoal}/day` : "—"}
                </div>
                <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                  Today +24h: {c.itemsCreatedLast24h} new items
                  {c.effectiveDailyGoal > 0 && (
                    <>
                      {" "}
                      (
                      {c.itemsCreatedLast24h >= c.effectiveDailyGoal ? (
                        <span className="text-green-500">on pace</span>
                      ) : (
                        <span className="text-amber-500">below goal</span>
                      )}
                      )
                    </>
                  )}
                </div>
              </div>
            </div>

            <FunnelBar c={c} />

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setKanbanWorkflowId(c.workflowId);
                  setKanbanLabel(c.packageName);
                }}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] hover:border-[#2563EB]"
              >
                Open board
              </button>
              <button
                type="button"
                onClick={() => setTargetingCampaign(c)}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-[#2563EB]/15 border border-[#2563EB]/40 text-[#2563EB] hover:bg-[#2563EB]/25"
              >
                Targeting config
              </button>
            </div>
          </article>
        ))}
      </div>

      {targetingCampaign && (
        <ScoutTargetingModal
          packageId={targetingCampaign.packageId}
          packageName={targetingCampaign.packageName}
          initial={targetingCampaign.scoutTargeting}
          onClose={() => setTargetingCampaign(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
