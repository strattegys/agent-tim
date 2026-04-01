"use client";

export type WorkflowStat = {
  id: string;
  name: string;
  stage: string;
  spec: string;
  itemType: string;
  ownerAgent: string | null;
  updatedAt: string | null;
  boardName: string | null;
  boardStages: Array<{ key: string; label: string; color: string }>;
  totalItems: number;
  stageCounts: Record<string, number>;
  alertCount: number;
};

function countForStage(counts: Record<string, number>, stageKey: string): number {
  const k = stageKey.trim();
  if (counts[k] != null) return counts[k];
  const upper = k.toUpperCase();
  if (counts[upper] != null) return counts[upper];
  for (const [key, n] of Object.entries(counts)) {
    if (key.toUpperCase() === upper) return n;
  }
  return 0;
}

function formatUpdated(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface WorkflowCardProps {
  workflow: WorkflowStat;
  onSelect: () => void;
}

export default function WorkflowCard({ workflow: w, onSelect }: WorkflowCardProps) {
  const stageLines =
    w.boardStages.length > 0
      ? w.boardStages.map((s) => ({
          label: s.label || s.key,
          n: countForStage(w.stageCounts, s.key),
        }))
      : Object.entries(w.stageCounts).map(([key, n]) => ({ label: key, n }));

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2.5 transition-colors hover:border-[var(--text-tertiary)] hover:bg-[var(--bg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-green)]/45"
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-[var(--text-primary)] truncate">{w.name}</div>
          {w.boardName ? (
            <div className="text-[10px] text-[var(--text-tertiary)] truncate mt-0.5">{w.boardName}</div>
          ) : null}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-0.5">
          <span className="text-[9px] font-mono uppercase text-[var(--text-tertiary)]">{w.stage}</span>
          <span className="text-[10px] font-semibold tabular-nums text-[var(--text-secondary)]">
            {w.totalItems} item{w.totalItems === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--text-secondary)]">
        <span className="font-mono text-[var(--text-tertiary)]">{w.itemType}</span>
        {w.ownerAgent ? (
          <span>
            Owner: <span className="text-[var(--accent-green)]">{w.ownerAgent}</span>
          </span>
        ) : null}
        {w.alertCount > 0 ? (
          <span className="text-amber-600 dark:text-amber-400 font-medium">{w.alertCount} alert{w.alertCount === 1 ? "" : "s"}</span>
        ) : null}
      </div>

      {stageLines.length > 0 ? (
        <ul className="mt-2 space-y-0.5 border-t border-[var(--border-color)]/80 pt-2">
          {stageLines.map((line) => (
            <li key={line.label} className="flex justify-between gap-2 text-[10px] text-[var(--text-tertiary)]">
              <span className="truncate">{line.label}</span>
              <span className="tabular-nums shrink-0 text-[var(--text-secondary)]">{line.n}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {w.updatedAt ? (
        <div className="mt-2 text-[9px] text-[var(--text-tertiary)]">Updated {formatUpdated(w.updatedAt)}</div>
      ) : null}

      <div className="mt-1.5 text-[9px] font-medium uppercase tracking-wide text-[var(--accent-blue)]">
        Open board →
      </div>
    </button>
  );
}
