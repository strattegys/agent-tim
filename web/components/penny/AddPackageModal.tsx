"use client";

import { useState, useEffect } from "react";
import type { PackageDeliverable } from "@/lib/package-types";

interface AddPackageModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function AddPackageModal({ open, onClose, onCreated }: AddPackageModalProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
    setName("");
  }, [open]);

  if (!open) return null;

  const handleCreate = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const trimmed = name.trim();
      const r = await fetch("/api/crm/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          templateId: "custom",
          name: trimmed || "New package",
          spec: { deliverables: [] as PackageDeliverable[] },
        }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(data.error || `Request failed (${r.status})`);
        return;
      }
      onCreated();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-pkg-title"
    >
      <div className="w-full max-w-md rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between gap-2">
          <h2 id="add-pkg-title" className="text-sm font-semibold text-[var(--text-primary)]">
            New package
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
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
            Creates a <strong>Draft</strong> package with no workflows yet. Open it from the kanban and use{" "}
            <strong>Add workflows</strong> in the overlay to define deliverables before testing.
          </p>
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">Package name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Agent Builder Launch"
              className="w-full text-[12px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
            />
          </label>
          {error ? <p className="text-[11px] text-red-400/90">{error}</p> : null}
        </div>
        <div className="px-4 py-3 border-t border-[var(--border-color)] flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleCreate()}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-[#E67E22] text-white font-semibold hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? "Creating…" : "Create package"}
          </button>
        </div>
      </div>
    </div>
  );
}
