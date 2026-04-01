"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { PACKAGE_TEMPLATES } from "@/lib/package-types";
import { panelBus } from "@/lib/events";

function parseSpec(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export interface OperationalPackageEditTarget {
  id: string;
  name: string;
  templateId: string;
  stage: string;
  spec: unknown;
}

interface OperationalPackageEditModalProps {
  pkg: OperationalPackageEditTarget;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function OperationalPackageEditModal({
  pkg,
  open,
  onClose,
  onSaved,
}: OperationalPackageEditModalProps) {
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState(pkg.name);
  const parsed = parseSpec(pkg.spec);
  const initialBrief = typeof parsed.brief === "string" ? parsed.brief : "";
  const template = PACKAGE_TEMPLATES[pkg.templateId];
  const showBrief =
    Boolean(template?.showPackageBrief) ||
    (typeof parsed.brief === "string" && parsed.brief.length > 0);
  const [brief, setBrief] = useState(initialBrief);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const prevBriefFromPkg =
    typeof parseSpec(pkg.spec).brief === "string" ? parseSpec(pkg.spec).brief : "";

  useEffect(() => setMounted(typeof document !== "undefined"), []);

  /**
   * Only hydrate from `pkg` when the dialog opens or the target package changes.
   * Do not depend on pkg.name / pkg.spec — the ops queue polls every few seconds and would
   * wipe fields while the user is typing.
   */
  useEffect(() => {
    if (!open) return;
    setName(pkg.name);
    const p = parseSpec(pkg.spec);
    setBrief(typeof p.brief === "string" ? p.brief : "");
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: omit pkg.name/pkg.spec (polling)
  }, [open, pkg.id]);

  const saveEdits = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setErr("Name cannot be empty");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const body: { id: string; name?: string; spec?: Record<string, unknown> } = { id: pkg.id };
      if (trimmed !== pkg.name.trim()) body.name = trimmed;
      if (showBrief && brief.trim() !== prevBriefFromPkg) {
        body.spec = { brief: brief.trim() };
      }
      if (!body.name && !body.spec) {
        onClose();
        return;
      }
      const r = await fetch("/api/crm/packages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErr(data.error || `Save failed (${r.status})`);
        return;
      }
      panelBus.emit("package_manager");
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }, [brief, name, onClose, onSaved, pkg.id, pkg.name, pkg.spec, prevBriefFromPkg, showBrief]);

  const moveToDraftKeepWorkflows = useCallback(async () => {
    if (
      !window.confirm(
        "Move this package to Draft? It will disappear from the live queue. " +
          "Workflows and work items keep running — use the Planner to see it again or keep editing."
      )
    ) {
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/crm/packages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: pkg.id, stage: "DRAFT" }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErr(data.error || `Could not move to draft (${r.status})`);
        return;
      }
      panelBus.emit("package_manager");
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }, [onClose, onSaved, pkg.id]);

  const resetToDraftWipe = useCallback(async () => {
    if (
      !window.confirm(
        "RESET package to Draft?\n\nThis deletes all workflows, boards, items, and artifacts for this package. " +
          "This cannot be undone.\n\nOnly use this if you intend to start over from scratch."
      )
    ) {
      return;
    }
    if (!window.confirm("Confirm: permanently delete all workflow data for this package?")) {
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/crm/packages/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ packageId: pkg.id, targetStage: "DRAFT" }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErr(data.error || `Reset failed (${r.status})`);
        return;
      }
      panelBus.emit("package_manager");
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }, [onClose, onSaved, pkg.id]);

  if (!open || !mounted) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-3 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="opkg-edit-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl p-3 space-y-3"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id="opkg-edit-title" className="text-sm font-semibold text-[var(--text-primary)]">
            Edit package
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-lg leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="text-[10px] text-[var(--text-tertiary)]">
          {pkg.templateId} · {pkg.stage}
        </p>

        <div className="space-y-1">
          <label className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wide">
            Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1.5 text-[var(--text-primary)]"
            disabled={saving}
          />
        </div>

        {showBrief ? (
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wide">
              Package brief
            </label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={5}
              className="w-full text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1.5 text-[var(--text-primary)] font-mono"
              disabled={saving}
              placeholder="Outreach or campaign context…"
            />
          </div>
        ) : null}

        {err ? <p className="text-[11px] text-red-500">{err}</p> : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            disabled={saving}
            onClick={saveEdits}
            className="text-[11px] px-3 py-1.5 rounded-md bg-[var(--accent-green)]/20 text-[var(--accent-green)] font-semibold border border-[var(--accent-green)]/40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="text-[11px] px-3 py-1.5 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)]"
          >
            Cancel
          </button>
        </div>

        <div className="border-t border-[var(--border-color)] pt-3 space-y-2">
          <p className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
            Draft
          </p>
          <button
            type="button"
            disabled={saving}
            onClick={moveToDraftKeepWorkflows}
            className="block w-full text-left text-[11px] px-2 py-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:border-[var(--accent-orange)]/50"
          >
            <span className="font-semibold">Move to Draft (keep workflows)</span>
            <span className="block text-[10px] text-[var(--text-tertiary)] mt-0.5">
              Removes the package from this live queue only. Workflows and items stay as-is; open Planner →
              Draft to keep editing.
            </span>
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={resetToDraftWipe}
            className="block w-full text-left text-[11px] px-2 py-2 rounded-md border border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/15"
          >
            <span className="font-semibold">Reset to Draft (delete all workflows)</span>
            <span className="block text-[10px] text-red-300/80 mt-0.5">
              Same as Planner “back to draft” — wipes boards, workflows, items, and artifacts.
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
