"use client";

export interface PackageKanbanCardData {
  id: string;
  name: string;
  templateId: string;
  stage: string;
  packageNumber?: number | null;
  workflowCount: number;
  itemCount?: number;
}

function InspectIcon({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

interface PackageKanbanCardProps {
  pkg: PackageKanbanCardData;
  onOpen: () => void;
}

/**
 * Minimal package tile for the Package Kanban — open details via the inspect control only.
 */
export default function PackageKanbanCard({ pkg, onOpen }: PackageKanbanCardProps) {
  const items = pkg.itemCount ?? 0;
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 pr-1.5">
      <div className="flex items-start gap-1.5 min-w-0">
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-baseline gap-1.5 min-w-0">
            {pkg.packageNumber != null && !Number.isNaN(pkg.packageNumber) ? (
              <span className="text-[9px] font-bold tabular-nums text-[var(--text-tertiary)] shrink-0">
                #{pkg.packageNumber}
              </span>
            ) : null}
            <span className="text-[11px] font-semibold text-[var(--text-primary)] truncate min-w-0">
              {pkg.name}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-[var(--text-tertiary)] tabular-nums">
            <span className="truncate font-mono">{pkg.templateId}</span>
            <span className="shrink-0">·</span>
            <span className="shrink-0">
              {pkg.workflowCount} wf{pkg.workflowCount !== 1 ? "s" : ""}
            </span>
            {pkg.itemCount != null && pkg.itemCount > 0 ? (
              <>
                <span className="shrink-0">·</span>
                <span className="shrink-0">
                  {items} item{items !== 1 ? "s" : ""}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="shrink-0 rounded-md p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] border border-transparent hover:border-[var(--border-color)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-green)]/45"
          title="Inspect package"
          aria-label={`Inspect package ${pkg.name}`}
        >
          <InspectIcon />
        </button>
      </div>
    </div>
  );
}
