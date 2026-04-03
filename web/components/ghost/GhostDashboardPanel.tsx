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

const GHOST_WF = new Set(["content-pipeline"]);

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">{value}</div>
      {sub ? <div className="text-[10px] text-[var(--text-tertiary)]">{sub}</div> : null}
    </div>
  );
}

function stageBucket(stage: string): "idea" | "draft" | "published" | "other" {
  const u = stage.toUpperCase();
  if (u === "IDEA" || u === "CAMPAIGN_SPEC") return "idea";
  if (u === "DRAFTING" || u === "REVIEW" || u === "DRAFT_PUBLISHED") return "draft";
  if (u === "PUBLISHED") return "published";
  return "other";
}

type GhostQueuePayload = { tasks?: { itemTitle?: string; stage?: string }[]; count?: number };

export default function GhostDashboardPanel() {
  const visible = useDocumentVisible();

  const { data: throughput } = useSWR<WorkflowThroughputPayload>(
    "/api/crm/workflow-throughput",
    fetchJson,
    { refreshInterval: visible ? 120_000 : 0, revalidateOnFocus: true, dedupingInterval: 15_000 },
  );

  const { data: queue } = useSWR<GhostQueuePayload>(
    "/api/crm/human-tasks?ownerAgent=ghost&sourceType=content&excludePackageStages=DRAFT,PENDING_APPROVAL",
    fetchJson,
    { refreshInterval: visible ? 45_000 : 0, revalidateOnFocus: true, dedupingInterval: 15_000 },
  );

  const goals = (throughput?.items ?? []).filter((r) => GHOST_WF.has(r.workflowTypeId));
  const measures = (throughput?.measures ?? []).filter((r) => GHOST_WF.has(r.workflowTypeId));

  const tasks = (queue?.tasks ?? []).filter(
    (t) => typeof t?.itemTitle === "string" || typeof t?.stage === "string",
  );
  const queueDepth = typeof queue?.count === "number" ? queue.count : tasks.length;

  let ideas = 0;
  let drafts = 0;
  let published = 0;
  for (const t of tasks) {
    const b = stageBucket(String(t.stage ?? ""));
    if (b === "idea") ideas += 1;
    else if (b === "draft") drafts += 1;
    else if (b === "published") published += 1;
  }

  const recent = tasks.slice(0, 5);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[var(--bg-primary)] px-3 py-3 space-y-3">
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">Ghost — Content pipeline</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Queue depth" value={queueDepth} sub="content tasks" />
        <Stat label="In idea / spec" value={ideas} />
        <Stat label="In draft / review" value={drafts} />
        <Stat label="Published stage" value={published} />
      </div>

      {goals.map((row: WorkflowThroughputRow) => (
        <div key={row.workflowTypeId} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/40 p-3">
          <p className="text-xs font-semibold text-[var(--text-primary)]">{row.workflowLabel}</p>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{row.metricLabel}</p>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-xl font-bold tabular-nums">{row.actual}</span>
            <span className="text-sm text-[var(--text-tertiary)]">/ {row.target}</span>
            <span className="text-[10px] text-[var(--text-tertiary)] ml-1">
              {row.period === "week" ? "weekly" : "daily"} goal
            </span>
          </div>
        </div>
      ))}

      {measures.map((row: WorkflowThroughputMeasureRow) => (
        <div key={row.workflowTypeId} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
          <p className="text-xs font-semibold text-[var(--text-primary)]">{row.workflowLabel}</p>
          <p className="text-lg font-bold tabular-nums mt-1">{row.actual}</p>
          <p className="text-[10px] text-[var(--text-tertiary)]">{row.metricLabel}</p>
        </div>
      ))}

      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] px-1">
        Recent queue
      </h3>
      {recent.length === 0 ? (
        <p className="text-xs text-[var(--text-tertiary)] px-1">No items in the content queue.</p>
      ) : (
        <ul className="space-y-1">
          {recent.map((t, i) => (
            <li
              key={`${t.itemTitle}-${i}`}
              className="text-xs text-[var(--text-primary)] rounded-md border border-[var(--border-color)]/60 bg-[var(--bg-secondary)]/30 px-2 py-1.5"
            >
              <span className="text-[10px] text-[var(--text-tertiary)] uppercase">{t.stage ?? "—"}</span>
              <span className="block line-clamp-2">{t.itemTitle || "Untitled"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
