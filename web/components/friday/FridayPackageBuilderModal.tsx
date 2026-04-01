"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PLANNER_PACKAGE_TEMPLATES,
  type PackageDeliverable,
  type PackageTemplateSpec,
} from "@/lib/package-types";
import { TIM_WARM_OUTREACH_PACKAGE_BRIEF } from "@/lib/package-spec-briefs/tim-warm-outreach-package-brief";

interface FridayPackageBuilderModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function FridayPackageBuilderModal({
  open,
  onClose,
  onCreated,
}: FridayPackageBuilderModalProps) {
  const templates = PLANNER_PACKAGE_TEMPLATES;
  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [deliverables, setDeliverables] = useState<PackageDeliverable[]>([]);
  const [brief, setBrief] = useState("");
  const [workflowIds, setWorkflowIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected: PackageTemplateSpec | undefined = templates.find((t) => t.id === templateId);

  const needsBrief = templateId === "vibe-coding-outreach";

  const workflowSelectIds = useMemo(() => {
    const s = new Set(workflowIds);
    for (const d of deliverables) s.add(d.workflowType);
    return [...s].sort();
  }, [workflowIds, deliverables]);

  const reset = useCallback(() => {
    setStep(0);
    const first = PLANNER_PACKAGE_TEMPLATES[0];
    setTemplateId(first?.id ?? "");
    setName("");
    setCustomerId("");
    setDeliverables(first ? JSON.parse(JSON.stringify(first.deliverables)) as PackageDeliverable[] : []);
    setBrief(TIM_WARM_OUTREACH_PACKAGE_BRIEF);
    setError(null);
    setSubmitting(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    let c = false;
    fetch("/api/crm/workflow-type-definitions", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { types?: { id: string }[] } | null) => {
        if (c || !data?.types) return;
        setWorkflowIds(data.types.map((t) => t.id));
      })
      .catch(() => {});
    return () => {
      c = true;
    };
  }, [open]);

  useEffect(() => {
    if (!selected) return;
    setDeliverables(JSON.parse(JSON.stringify(selected.deliverables)) as PackageDeliverable[]);
    if (templateId === "vibe-coding-outreach") {
      setBrief(TIM_WARM_OUTREACH_PACKAGE_BRIEF);
    }
  }, [templateId, selected]);

  if (!open) return null;

  if (templates.length === 0) {
    return (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 shadow-xl">
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-3">
            There are no catalog package templates. Use <strong className="text-[var(--text-primary)]">New package</strong>{" "}
            on Package Kanban, then add deliverables on the package card.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-[#9B59B6] text-white font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const goNext = () => {
    setError(null);
    if (step === 1 && !name.trim() && selected) {
      setName(selected.label);
    }
    if (step === 2) {
      for (const d of deliverables) {
        if (!workflowIds.includes(d.workflowType)) {
          setError(`Unknown workflow type: ${d.workflowType}. Add it under Workflow templates first.`);
          return;
        }
      }
    }
    if (step === 3 && needsBrief && !brief.trim()) {
      setError("Campaign brief is required for this template.");
      return;
    }
    if (step === 2 && !needsBrief) {
      setStep(4);
      return;
    }
    if (step < 4) setStep(step + 1);
  };

  const goBack = () => {
    setError(null);
    if (step === 0) return;
    if (step === 4 && !needsBrief) {
      setStep(2);
      return;
    }
    setStep(step - 1);
  };

  const handleCreate = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const spec: Record<string, unknown> = { deliverables };
      if (needsBrief) spec.brief = brief.trim();
      const body: Record<string, unknown> = {
        templateId,
        name: name.trim() || selected?.label,
        spec,
      };
      const cid = customerId.trim();
      if (cid) {
        body.customerId = cid;
        body.customerType = "person";
      }
      const r = await fetch("/api/crm/packages", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(data.error || `Failed (${r.status})`);
        return;
      }
      onCreated();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const displayStepLabel = () => {
    if (step === 4) return "Review & create";
    const labels = ["Template", "Name & customer", "Deliverables", "Campaign brief"] as const;
    return labels[step] ?? "";
  };

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between gap-2 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Package builder</h2>
            <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{displayStepLabel()}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 rounded"
          >
            ✕
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {step === 0 && (
            <>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">Template</span>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="w-full text-[12px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2 py-2 text-[var(--text-primary)]"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              {selected ? (
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{selected.description}</p>
              ) : null}
            </>
          )}

          {step === 1 && (
            <>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">Package name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={selected?.label}
                  className="w-full text-[12px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2 py-2 text-[var(--text-primary)]"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">
                  Customer id (optional, CRM uuid)
                </span>
                <input
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="w-full text-[11px] font-mono bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2 py-2 text-[var(--text-primary)]"
                />
              </label>
            </>
          )}

          {step === 2 && (
            <div className="space-y-2">
              <p className="text-[11px] text-[var(--text-secondary)]">
                Each deliverable must use a workflow type that exists in the registry (built-in or custom).
              </p>
              {deliverables.map((d, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-[var(--border-color)] p-2 space-y-2 bg-[var(--bg-primary)]/40"
                >
                  <input
                    value={d.label}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDeliverables((prev) => prev.map((x, j) => (j === i ? { ...x, label: v } : x)));
                    }}
                    className="w-full text-[11px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1"
                    placeholder="Label"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={d.workflowType}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDeliverables((prev) => prev.map((x, j) => (j === i ? { ...x, workflowType: v } : x)));
                      }}
                      className="text-[11px] font-mono bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1"
                    >
                      {workflowSelectIds.map((wid) => (
                        <option key={wid} value={wid}>
                          {wid}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      value={d.targetCount}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10) || 0;
                        setDeliverables((prev) => prev.map((x, j) => (j === i ? { ...x, targetCount: v } : x)));
                      }}
                      className="text-[11px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1"
                    />
                    <input
                      value={d.ownerAgent}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDeliverables((prev) => prev.map((x, j) => (j === i ? { ...x, ownerAgent: v } : x)));
                      }}
                      className="text-[11px] col-span-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1"
                      placeholder="ownerAgent"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 3 && needsBrief && (
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">Campaign brief</span>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={12}
                className="w-full text-[11px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2 py-2 text-[var(--text-primary)] font-mono leading-relaxed"
              />
            </label>
          )}

          {step === 4 && (
            <div className="text-[11px] text-[var(--text-secondary)] space-y-2">
              <p>
                <span className="text-[var(--text-tertiary)]">Template:</span> {selected?.label} ({templateId})
              </p>
              <p>
                <span className="text-[var(--text-tertiary)]">Name:</span> {name.trim() || selected?.label}
              </p>
              {customerId.trim() ? (
                <p>
                  <span className="text-[var(--text-tertiary)]">Customer:</span> {customerId.trim()}
                </p>
              ) : null}
              <p>
                <span className="text-[var(--text-tertiary)]">Deliverables:</span> {deliverables.length}
              </p>
            </div>
          )}

          {error ? <p className="text-[11px] text-red-400/90">{error}</p> : null}
        </div>

        <div className="px-4 py-3 border-t border-[var(--border-color)] flex justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] disabled:opacity-40"
          >
            Back
          </button>
          <div className="flex gap-2">
            {step < 4 ? (
              <button
                type="button"
                onClick={goNext}
                className="text-[11px] px-3 py-1.5 rounded-lg bg-[#E67E22] text-white font-semibold"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleCreate()}
                className="text-[11px] px-3 py-1.5 rounded-lg bg-[#E67E22] text-white font-semibold disabled:opacity-40"
              >
                {submitting ? "Creating…" : "Create package"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
