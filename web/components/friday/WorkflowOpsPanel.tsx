"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import WorkflowCard, { type WorkflowStat } from "./WorkflowRow";
import KanbanInlinePanel from "@/components/kanban/KanbanInlinePanel";
import { panelBus } from "@/lib/events";
import {
  validateWorkflowAgainstModel,
  worstSeverity,
  type WorkflowComplianceSeverity,
} from "@/lib/workflow-model-validate";

function normalizeBoardStages(
  raw: unknown
): Array<{ key: string; label: string; color: string }> {
  if (Array.isArray(raw)) {
    return raw.filter(
      (s): s is { key: string; label: string; color: string } =>
        s != null &&
        typeof s === "object" &&
        typeof (s as { key?: string }).key === "string"
    ) as Array<{ key: string; label: string; color: string }>;
  }
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      return normalizeBoardStages(p);
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeSpec(spec: unknown): string {
  if (spec == null) return "";
  if (typeof spec === "string") return spec;
  try {
    return JSON.stringify(spec, null, 2);
  } catch {
    return String(spec);
  }
}

function normalizeWorkflowStat(row: Record<string, unknown>): WorkflowStat {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    stage: String(row.stage ?? ""),
    spec: normalizeSpec(row.spec),
    itemType: String(row.itemType ?? "person"),
    ownerAgent:
      row.ownerAgent == null ? null : String(row.ownerAgent),
    updatedAt: row.updatedAt == null ? null : String(row.updatedAt),
    boardId: row.boardId == null || row.boardId === "" ? null : String(row.boardId),
    boardName: row.boardName == null ? null : String(row.boardName),
    boardStages: normalizeBoardStages(row.boardStages),
    boardTransitions: row.boardTransitions ?? null,
    totalItems: typeof row.totalItems === "number" ? row.totalItems : 0,
    stageCounts:
      row.stageCounts != null && typeof row.stageCounts === "object"
        ? (row.stageCounts as Record<string, number>)
        : {},
    alertCount:
      typeof row.alertCount === "number" ? row.alertCount : 0,
  };
}

function parseSpecForValidate(raw: string): unknown {
  const t = raw.trim();
  if (!t) return {};
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

function upperStageCounts(m: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) {
    const u = k.trim().toUpperCase();
    out[u] = (out[u] ?? 0) + v;
  }
  return out;
}

function complianceRank(s: WorkflowComplianceSeverity | null | undefined): number {
  if (s === "error") return 0;
  if (s === "warn") return 1;
  if (s === "info") return 2;
  return 3;
}

export default function WorkflowOpsPanel() {
  const [workflows, setWorkflows] = useState<WorkflowStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(
    null
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/crm/workflow-stats", {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await res.json()) as {
        workflows?: unknown[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || res.statusText || "Failed to load workflows");
        setWorkflows([]);
        return;
      }
      const rows = Array.isArray(data.workflows) ? data.workflows : [];
      setWorkflows(rows.map((r) => normalizeWorkflowStat(r as Record<string, unknown>)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workflows");
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      void load();
    };
    const unsubs = [
      panelBus.on("dashboard_sync", refresh),
      panelBus.on("workflow_items", refresh),
      panelBus.on("workflow_manager", refresh),
      panelBus.on("package_manager", refresh),
    ];
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [load]);

  const complianceById = useMemo(() => {
    const severity = new Map<string, WorkflowComplianceSeverity | null>();
    const hint = new Map<string, string>();
    for (const w of workflows) {
      const issues = validateWorkflowAgainstModel({
        id: w.id,
        name: w.name,
        lifecycleStage: w.stage,
        spec: parseSpecForValidate(w.spec),
        itemType: w.itemType,
        boardId: w.boardId,
        ownerAgent: w.ownerAgent,
        boardStages: w.boardStages,
        boardTransitions: w.boardTransitions,
        itemStageCounts: upperStageCounts(w.stageCounts),
      });
      severity.set(w.id, worstSeverity(issues));
      if (issues.length > 0) {
        const lines = issues.slice(0, 5).map((i) => i.message);
        const extra = issues.length > 5 ? `\n+${issues.length - 5} more` : "";
        hint.set(w.id, lines.join("\n") + extra);
      }
    }
    return { severity, hint };
  }, [workflows]);

  const sortedWorkflows = useMemo(() => {
    return [...workflows].sort((a, b) => {
      const ra = complianceRank(complianceById.severity.get(a.id));
      const rb = complianceRank(complianceById.severity.get(b.id));
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  }, [workflows, complianceById]);

  if (selected) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[var(--bg-primary)]">
        <div className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer px-2 py-1 rounded border border-[var(--border-color)]"
          >
            ← All workflows
          </button>
          <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
            {selected.name}
          </span>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <KanbanInlinePanel
            onClose={() => setSelected(null)}
            fixedWorkflowId={selected.id}
            fixedWorkflowLabel={selected.name}
            agentId="friday"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[var(--bg-primary)]">
      <div className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          Pipelines
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)]">
          Live boards — left accent shows registry fit (red = needs attention). Click a card for Kanban.
        </span>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          disabled={loading}
          className="ml-auto text-[10px] font-medium px-2 py-1 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {error && (
          <div className="mb-3 text-xs text-[var(--accent-orange)] border border-[var(--accent-orange)]/40 rounded-lg px-3 py-2 bg-[var(--accent-orange)]/10">
            {error}
            <div className="text-[10px] text-[var(--text-tertiary)] mt-1">
              Check <code className="text-[var(--text-secondary)]">CRM_DB_*</code>{" "}
              in <code className="text-[var(--text-secondary)]">.env.local</code>{" "}
              and tunnel if needed.
            </div>
          </div>
        )}

        {loading && workflows.length === 0 && !error && (
          <p className="text-sm text-[var(--text-tertiary)]">Loading workflows…</p>
        )}

        {!loading && workflows.length === 0 && !error && (
          <p className="text-sm text-[var(--text-tertiary)]">
            No workflows in CRM yet.
          </p>
        )}

        {workflows.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {sortedWorkflows.map((w) => (
              <WorkflowCard
                key={w.id}
                workflow={w}
                onSelect={() => setSelected({ id: w.id, name: w.name })}
                complianceSeverity={complianceById.severity.get(w.id) ?? null}
                complianceHint={complianceById.hint.get(w.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
