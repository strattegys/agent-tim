"use client";

import { useState, useEffect, useCallback } from "react";
import type { PackageDeliverable } from "@/lib/package-types";
import type { WorkflowTypeSpec } from "@/lib/workflow-types";
import PackageWorkflowsEditor from "./PackageWorkflowsEditor";

interface PackageWorkflowsEditorModalProps {
  open: boolean;
  onClose: () => void;
  packageId: string;
  /** Full spec merge — we preserve brief and other keys */
  packageSpec: unknown;
  initialDeliverables: PackageDeliverable[];
  onSaved: () => void;
  title?: string;
}

export default function PackageWorkflowsEditorModal({
  open,
  onClose,
  packageId,
  packageSpec,
  initialDeliverables,
  onSaved,
  title = "Package workflows",
}: PackageWorkflowsEditorModalProps) {
  const [deliverables, setDeliverables] = useState<PackageDeliverable[]>(initialDeliverables);
  const [types, setTypes] = useState<WorkflowTypeSpec[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDeliverables(initialDeliverables.map((d) => ({ ...d })));
    setError(null);
  }, [open, initialDeliverables]);

  useEffect(() => {
    if (!open) return;
    let c = false;
    fetch("/api/crm/workflow-type-definitions", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { types?: WorkflowTypeSpec[] } | null) => {
        if (c || !data?.types?.length) return;
        setTypes(data.types);
      })
      .catch(() => {});
    return () => {
      c = true;
    };
  }, [open]);

  const handleSave = useCallback(async () => {
    if (deliverables.length === 0) {
      setError("Add at least one workflow before saving.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const base =
        packageSpec == null
          ? {}
          : typeof packageSpec === "string"
            ? (JSON.parse(packageSpec) as Record<string, unknown>)
            : { ...(packageSpec as Record<string, unknown>) };
      const spec = { ...base, deliverables };
      const r = await fetch("/api/crm/packages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: packageId, spec }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(data.error || `Save failed (${r.status})`);
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }, [deliverables, packageId, packageSpec, onClose, onSaved]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/65"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pkg-wf-editor-title"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl">
        <div className="sticky top-0 z-10 px-4 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center justify-between gap-2">
          <h2 id="pkg-wf-editor-title" className="text-sm font-semibold text-[var(--text-primary)]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 rounded"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="p-4">
          {types.length === 0 ? (
            <p className="text-[11px] text-[var(--text-tertiary)] py-4">Loading workflow types…</p>
          ) : (
            <PackageWorkflowsEditor
              deliverables={deliverables}
              onChange={setDeliverables}
              workflowTypes={types}
              disabled={saving}
            />
          )}
          {error ? <p className="text-[11px] text-red-400/90 mt-2">{error}</p> : null}
        </div>
        <div className="sticky bottom-0 px-4 py-3 border-t border-[var(--border-color)] bg-[var(--bg-secondary)] flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || types.length === 0}
            onClick={() => void handleSave()}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-[#9B59B6] text-white font-semibold disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save workflows"}
          </button>
        </div>
      </div>
    </div>
  );
}
