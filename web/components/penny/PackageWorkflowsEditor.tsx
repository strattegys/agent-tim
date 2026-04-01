"use client";

import type { PackageDeliverable } from "@/lib/package-types";
import type { WorkflowTypeSpec } from "@/lib/workflow-types";

const OWNER_OPTIONS = ["tim", "ghost", "scout", "marni", "penny", "friday", "king"] as const;

export interface PackageWorkflowsEditorProps {
  deliverables: PackageDeliverable[];
  onChange: (next: PackageDeliverable[]) => void;
  workflowTypes: WorkflowTypeSpec[];
  disabled?: boolean;
}

export default function PackageWorkflowsEditor({
  deliverables,
  onChange,
  workflowTypes,
  disabled = false,
}: PackageWorkflowsEditorProps) {
  const addRow = () => {
    const first = workflowTypes[0];
    onChange([
      ...deliverables,
      {
        workflowType: first?.id ?? "linkedin-opener-sequence",
        ownerAgent: "tim",
        targetCount: 10,
        label: first?.label ?? "New workflow",
      },
    ]);
  };

  const removeRow = (index: number) => {
    onChange(deliverables.filter((_, i) => i !== index));
  };

  const patchRow = (index: number, patch: Partial<PackageDeliverable>) => {
    onChange(deliverables.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
        Each line is one workflow Tim (or another owner) will get when you <strong>Activate</strong>. Order is
        the order used for dependencies in advanced packages.
      </p>
      <div className="space-y-2 max-h-[min(52vh,420px)] overflow-y-auto pr-1">
        {deliverables.map((d, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/50 p-2.5 space-y-2"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block space-y-0.5">
                <span className="text-[9px] font-semibold text-[var(--text-tertiary)]">Workflow type</span>
                <select
                  disabled={disabled}
                  value={d.workflowType}
                  onChange={(e) => {
                    const id = e.target.value;
                    const spec = workflowTypes.find((t) => t.id === id);
                    patchRow(idx, {
                      workflowType: id,
                      label: spec?.label ?? id,
                    });
                  }}
                  className="w-full text-[11px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md px-2 py-1.5 text-[var(--text-primary)]"
                >
                  {workflowTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} ({t.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-0.5">
                <span className="text-[9px] font-semibold text-[var(--text-tertiary)]">Owner agent</span>
                <select
                  disabled={disabled}
                  value={d.ownerAgent}
                  onChange={(e) => patchRow(idx, { ownerAgent: e.target.value })}
                  className="w-full text-[11px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md px-2 py-1.5 text-[var(--text-primary)]"
                >
                  {OWNER_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-0.5 sm:col-span-2">
                <span className="text-[9px] font-semibold text-[var(--text-tertiary)]">Label (on package card)</span>
                <input
                  disabled={disabled}
                  value={d.label}
                  onChange={(e) => patchRow(idx, { label: e.target.value })}
                  className="w-full text-[11px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md px-2 py-1.5 text-[var(--text-primary)]"
                />
              </label>
              <label className="block space-y-0.5">
                <span className="text-[9px] font-semibold text-[var(--text-tertiary)]">Target count</span>
                <input
                  disabled={disabled}
                  type="number"
                  min={0}
                  value={d.targetCount}
                  onChange={(e) =>
                    patchRow(idx, { targetCount: Math.max(0, parseInt(e.target.value, 10) || 0) })
                  }
                  className="w-full text-[11px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md px-2 py-1.5 text-[var(--text-primary)]"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => removeRow(idx)}
              className="text-[10px] text-red-400/90 hover:underline disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={addRow}
        className="text-[10px] font-semibold px-2.5 py-1.5 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
      >
        + Add workflow
      </button>
    </div>
  );
}
