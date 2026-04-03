"use client";

import useSWR from "swr";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type {
  WorkflowThroughputPayload,
  WorkflowThroughputRow,
  WorkflowThroughputMeasureRow,
} from "@/lib/workflow-throughput-types";

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(`Error ${r.status}`);
  return r.json() as Promise<T>;
}

/** Throughput rows owned by Marni’s workflows in the registry. */
const MARNI_WF_PREFIX = new Set(["content-distribution"]);

function isMarniWorkflow(id: string): boolean {
  if (MARNI_WF_PREFIX.has(id)) return true;
  return id.includes("influencer") || id.includes("marni");
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

type MarniQueuePayload = { count?: number; tasks?: unknown[] };

type TopicsPayload = { topics?: unknown[]; error?: string };

export default function MarniDashboardPanel() {
  const visible = useDocumentVisible();

  const { data: throughput } = useSWR<WorkflowThroughputPayload>(
    "/api/crm/workflow-throughput",
    fetchJson,
    { refreshInterval: visible ? 120_000 : 0, revalidateOnFocus: true, dedupingInterval: 15_000 },
  );

  const { data: queue } = useSWR<MarniQueuePayload>(
    "/api/crm/human-tasks?ownerAgent=marni&distributionOnly=1&excludePackageStages=DRAFT,PENDING_APPROVAL",
    fetchJson,
    { refreshInterval: visible ? 45_000 : 0, revalidateOnFocus: true, dedupingInterval: 15_000 },
  );

  const { data: kb } = useSWR<TopicsPayload>(
    "/api/marni-kb/topics?agentId=marni",
    fetchJson,
    { refreshInterval: visible ? 120_000 : 0, revalidateOnFocus: true, dedupingInterval: 30_000 },
  );

  const goals = (throughput?.items ?? []).filter((r) => isMarniWorkflow(r.workflowTypeId));
  const measures = (throughput?.measures ?? []).filter((r) => isMarniWorkflow(r.workflowTypeId));
  const ownerMarni = (throughput?.items ?? []).filter((r) =>
    String(r.ownerLabel).toLowerCase().includes("marni"),
  );
  const ownerMarniM = (throughput?.measures ?? []).filter((r) =>
    String(r.ownerLabel).toLowerCase().includes("marni"),
  );
  const mergedGoals = goals.length ? goals : ownerMarni;
  const mergedMeasures = measures.length ? measures : ownerMarniM;

  const queueDepth =
    typeof queue?.count === "number" ? queue.count : (queue?.tasks?.length ?? 0);
  const topicCount = Array.isArray(kb?.topics) ? kb.topics.length : null;
  const kbErr = kb?.error;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[var(--bg-primary)] px-3 py-3 space-y-3">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">Marni — Distribution &amp; KB</h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Stat label="Distribution queue" value={queueDepth} sub="open / scheduled" />
        <Stat
          label="KB topics"
          value={topicCount ?? "—"}
          sub={kbErr ? "KB unavailable" : topicCount != null ? "Marni knowledge base" : "Loading…"}
        />
      </div>

      {mergedGoals.map((row: WorkflowThroughputRow) => (
        <div key={row.workflowTypeId} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/40 p-3">
          <p className="text-xs font-semibold text-[var(--text-primary)]">{row.workflowLabel}</p>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{row.metricLabel}</p>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-xl font-bold tabular-nums">{row.actual}</span>
            <span className="text-sm text-[var(--text-tertiary)]">/ {row.target}</span>
          </div>
        </div>
      ))}

      {mergedMeasures.map((row: WorkflowThroughputMeasureRow) => (
        <div key={row.workflowTypeId} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
          <p className="text-xs font-semibold text-[var(--text-primary)]">{row.workflowLabel}</p>
          <p className="text-lg font-bold tabular-nums mt-1">{row.actual}</p>
          <p className="text-[10px] text-[var(--text-tertiary)]">{row.metricLabel}</p>
        </div>
      ))}

      {mergedGoals.length === 0 && mergedMeasures.length === 0 ? (
        <p className="text-xs text-[var(--text-tertiary)] border border-[var(--border-color)]/60 rounded-lg p-3">
          No throughput goals for Marni yet. Add <code className="text-[10px]">throughputGoal</code> on her
          workflow types or activate a package with content distribution.
        </p>
      ) : null}
    </div>
  );
}
