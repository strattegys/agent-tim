"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import WorkflowTemplateCard from "@/components/penny/WorkflowTemplateCard";
import type { StageSpec, WorkflowThroughputGoalSpec, WorkflowTypeSpec } from "@/lib/workflow-types";
import { validateDefaultBoard } from "@/lib/workflow-type-definition-validate";

type DefRow = WorkflowTypeSpec & { source: "builtin" | "custom" };

function emptyStage(): StageSpec {
  return {
    key: "",
    label: "",
    color: "#64748b",
    instructions: "",
    requiresHuman: false,
    humanAction: "",
  };
}

function WorkflowTypeEditorModal({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: "new" | "edit";
  initial: WorkflowTypeSpec | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [id, setId] = useState(initial?.id ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [itemType, setItemType] = useState<"person" | "content">(initial?.itemType ?? "person");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [stages, setStages] = useState<StageSpec[]>(() =>
    initial?.defaultBoard.stages?.length ? [...initial.defaultBoard.stages] : [emptyStage()]
  );
  const [transText, setTransText] = useState<Record<string, string>>(() => {
    const t = initial?.defaultBoard.transitions ?? {};
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(t)) {
      o[k] = v.join(", ");
    }
    return o;
  });
  const [goalEnabled, setGoalEnabled] = useState(Boolean(initial?.throughputGoal));
  const [goal, setGoal] = useState<WorkflowThroughputGoalSpec>(
    initial?.throughputGoal ?? {
      period: "day",
      target: 5,
      metric: "warm_outreach_dm_sent",
      ownerLabel: "Tim",
      metricLabel: "LinkedIn DMs sent",
    }
  );
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const syncTransKeys = useCallback(() => {
    setTransText((prev) => {
      const next = { ...prev };
      for (const s of stages) {
        const k = s.key.trim();
        if (k && next[k] === undefined) next[k] = prev[k] ?? "";
      }
      for (const k of Object.keys(next)) {
        if (!stages.some((s) => s.key.trim() === k)) delete next[k];
      }
      return next;
    });
  }, [stages]);

  useEffect(() => {
    syncTransKeys();
  }, [stages, syncTransKeys]);

  const buildBoard = () => {
    const transitions: Record<string, string[]> = {};
    for (const s of stages) {
      const k = s.key.trim();
      if (!k) continue;
      const raw = transText[k] ?? "";
      transitions[k] = raw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    }
    return { stages, transitions };
  };

  const previewSpec = useMemo((): WorkflowTypeSpec => {
    const board = buildBoard();
    return {
      id: id.trim() || "preview",
      label: label.trim() || "Preview",
      itemType,
      description,
      defaultBoard: board,
      ...(goalEnabled && goal ? { throughputGoal: goal } : {}),
    };
  }, [id, label, itemType, description, stages, transText, goalEnabled, goal]);

  const handleSave = async () => {
    setErr(null);
    const board = buildBoard();
    const vr = validateDefaultBoard(board);
    if (!vr.ok) {
      setErr(vr.errors.join(" "));
      return;
    }
    setSaving(true);
    try {
      const body = {
        id: id.trim(),
        label: label.trim(),
        itemType,
        description,
        defaultBoard: board,
        throughputGoal: goalEnabled ? goal : null,
      };
      const url =
        mode === "new"
          ? "/api/crm/workflow-type-definitions"
          : `/api/crm/workflow-type-definitions/${encodeURIComponent(initial!.id)}`;
      const r = await fetch(url, {
        method: mode === "new" ? "POST" : "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string; details?: string[] };
      if (!r.ok) {
        setErr(
          [data.error, ...(data.details || [])].filter(Boolean).join(" — ") || `Failed (${r.status})`
        );
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center p-3 bg-black/65"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl">
        <div className="sticky top-0 z-10 px-4 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {mode === "new" ? "New workflow type" : `Edit ${initial?.id}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 rounded"
          >
            ✕
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">Id (slug)</span>
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                disabled={mode === "edit"}
                className="w-full text-[12px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2 py-2 text-[var(--text-primary)] disabled:opacity-60"
                placeholder="my-custom-pipeline"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">Label</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full text-[12px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2 py-2 text-[var(--text-primary)]"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">Item type</span>
              <select
                value={itemType}
                onChange={(e) => setItemType(e.target.value as "person" | "content")}
                className="w-full text-[12px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2 py-2 text-[var(--text-primary)]"
              >
                <option value="person">person</option>
                <option value="content">content</option>
              </select>
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full text-[12px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2 py-2 text-[var(--text-primary)]"
              />
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide">
                Stages
              </span>
              <button
                type="button"
                onClick={() => setStages((s) => [...s, emptyStage()])}
                className="text-[10px] font-medium px-2 py-1 rounded border border-[var(--border-color)] text-[var(--text-secondary)]"
              >
                + Stage
              </button>
            </div>
            {stages.map((s, i) => (
              <div
                key={i}
                className="rounded-lg border border-[var(--border-color)] p-2 space-y-2 bg-[var(--bg-primary)]/40"
              >
                <div className="grid grid-cols-2 gap-2">
                  <input
                    placeholder="KEY"
                    value={s.key}
                    onChange={(e) => {
                      const v = e.target.value;
                      setStages((prev) => prev.map((x, j) => (j === i ? { ...x, key: v } : x)));
                    }}
                    className="text-[11px] font-mono bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1"
                  />
                  <input
                    placeholder="Label"
                    value={s.label}
                    onChange={(e) => {
                      const v = e.target.value;
                      setStages((prev) => prev.map((x, j) => (j === i ? { ...x, label: v } : x)));
                    }}
                    className="text-[11px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1"
                  />
                  <input
                    type="color"
                    value={s.color?.startsWith("#") ? s.color : "#64748b"}
                    onChange={(e) => {
                      const v = e.target.value;
                      setStages((prev) => prev.map((x, j) => (j === i ? { ...x, color: v } : x)));
                    }}
                    className="h-8 w-full rounded border border-[var(--border-color)] bg-[var(--bg-primary)]"
                  />
                  <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={Boolean(s.requiresHuman)}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setStages((prev) => prev.map((x, j) => (j === i ? { ...x, requiresHuman: v } : x)));
                      }}
                    />
                    Requires human
                  </label>
                </div>
                <textarea
                  placeholder="Instructions for the agent"
                  value={s.instructions}
                  onChange={(e) => {
                    const v = e.target.value;
                    setStages((prev) => prev.map((x, j) => (j === i ? { ...x, instructions: v } : x)));
                  }}
                  rows={2}
                  className="w-full text-[11px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1"
                />
                {s.requiresHuman ? (
                  <input
                    placeholder="Human action description"
                    value={s.humanAction || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setStages((prev) => prev.map((x, j) => (j === i ? { ...x, humanAction: v } : x)));
                    }}
                    className="w-full text-[11px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1"
                  />
                ) : null}
                {s.key.trim() ? (
                  <label className="block space-y-0.5">
                    <span className="text-[9px] text-[var(--text-tertiary)]">
                      Transitions from {s.key.trim()} (comma-separated stage keys)
                    </span>
                    <input
                      value={transText[s.key.trim()] ?? ""}
                      onChange={(e) =>
                        setTransText((prev) => ({ ...prev, [s.key.trim()]: e.target.value }))
                      }
                      className="w-full text-[11px] font-mono bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1"
                    />
                  </label>
                ) : null}
                <button
                  type="button"
                  onClick={() => setStages((prev) => prev.filter((_, j) => j !== i))}
                  className="text-[10px] text-red-400/90"
                >
                  Remove stage
                </button>
              </div>
            ))}
          </div>

          <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={goalEnabled}
              onChange={(e) => setGoalEnabled(e.target.checked)}
            />
            Friday Goals throughput target (optional)
          </label>
          {goalEnabled ? (
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border-color)] p-2">
              <select
                value={goal.period}
                onChange={(e) => setGoal((g) => ({ ...g, period: e.target.value as "day" | "week" }))}
                className="text-[11px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1"
              >
                <option value="day">day</option>
                <option value="week">week</option>
              </select>
              <input
                type="number"
                min={0}
                value={goal.target}
                onChange={(e) => setGoal((g) => ({ ...g, target: parseFloat(e.target.value) || 0 }))}
                className="text-[11px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1"
              />
              <select
                value={goal.metric}
                onChange={(e) =>
                  setGoal((g) => ({
                    ...g,
                    metric: e.target.value as WorkflowThroughputGoalSpec["metric"],
                  }))
                }
                className="text-[11px] col-span-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1"
              >
                <option value="warm_outreach_dm_sent">warm_outreach_dm_sent</option>
                <option value="content_article_published">content_article_published</option>
              </select>
              <input
                placeholder="Owner label"
                value={goal.ownerLabel}
                onChange={(e) => setGoal((g) => ({ ...g, ownerLabel: e.target.value }))}
                className="text-[11px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1"
              />
              <input
                placeholder="Metric label"
                value={goal.metricLabel}
                onChange={(e) => setGoal((g) => ({ ...g, metricLabel: e.target.value }))}
                className="text-[11px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1"
              />
            </div>
          ) : null}

          <div className="border border-[var(--border-color)] rounded-lg p-2 bg-[var(--bg-primary)]/30">
            <p className="text-[10px] font-semibold text-[var(--text-tertiary)] mb-2">Preview</p>
            <WorkflowTemplateCard template={previewSpec} />
          </div>

          {err ? <p className="text-[11px] text-red-400/90">{err}</p> : null}

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-color)]">
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="text-[11px] px-3 py-1.5 rounded-lg bg-[#9B59B6] text-white font-semibold disabled:opacity-50"
            >
              {saving ? "Saving…" : mode === "new" ? "Create" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FridayWorkflowTemplatesPanel() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<DefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: "new" | "edit"; spec: WorkflowTypeSpec | null } | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/crm/workflow-type-definitions", { credentials: "include" });
      const data = (await r.json()) as { types?: DefRow[]; error?: string };
      if (!r.ok) {
        setError(data.error || `Failed (${r.status})`);
        setRows([]);
        return;
      }
      setRows(data.types ?? []);
    } catch {
      setError("Network error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const nw = searchParams.get("newWorkflowType");
    const ed = searchParams.get("edit");
    if (nw === "1" || nw === "true") {
      setEditor({ mode: "new", spec: null });
    } else if (ed?.trim()) {
      const found = rows.find((r) => r.id === ed.trim());
      if (found && found.source === "custom") {
        setEditor({
          mode: "edit",
          spec: {
            id: found.id,
            label: found.label,
            itemType: found.itemType,
            description: found.description,
            defaultBoard: found.defaultBoard,
            throughputGoal: found.throughputGoal,
          },
        });
      }
    }
  }, [searchParams, rows]);

  const sortedRows = useMemo(() => {
    const builtins = rows.filter((r) => r.source === "builtin");
    const customs = rows.filter((r) => r.source === "custom");
    const byLabel = (a: DefRow, b: DefRow) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    builtins.sort(byLabel);
    customs.sort(byLabel);
    return [...builtins, ...customs];
  }, [rows]);

  const deleteCustom = async (id: string) => {
    if (!confirm(`Delete workflow type "${id}"? Packages using it may fail on activate.`)) return;
    const r = await fetch(`/api/crm/workflow-type-definitions/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!r.ok) {
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      alert(d.error || "Delete failed");
      return;
    }
    void load();
  };

  const deepLinkNew = "/?agent=friday&panel=wf-templates&newWorkflowType=1";

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      {editor ? (
        <WorkflowTypeEditorModal
          mode={editor.mode}
          initial={editor.spec}
          onClose={() => setEditor(null)}
          onSaved={() => void load()}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--text-secondary)] max-w-xl leading-relaxed">
          All workflow types are the same kind of definition; seven ship with the product, and any
          additional ones you add are tagged <span className="font-medium text-[var(--text-primary)]">New type</span>{" "}
          (stored in the CRM). Ids must stay unique.{" "}
          <Link href={deepLinkNew} className="text-[var(--text-primary)] underline font-medium">
            Open “new type” via URL
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={() => setEditor({ mode: "new", spec: null })}
          className="text-[10px] font-semibold px-2.5 py-1.5 rounded-md bg-[#9B59B6] text-white"
        >
          New type
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--text-tertiary)] py-8 text-center">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-400/90 py-4">{error}</p>
      ) : sortedRows.length === 0 ? (
        <p className="text-[11px] text-[var(--text-tertiary)] py-6">No workflow types loaded.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {sortedRows.map((tmpl) => (
            <WorkflowTemplateCard
              key={tmpl.id}
              template={tmpl}
              badge={tmpl.source === "custom" ? "New type" : undefined}
              footer={
                tmpl.source === "custom" ? (
                  <div className="flex flex-wrap gap-2 mt-auto pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        setEditor({
                          mode: "edit",
                          spec: {
                            id: tmpl.id,
                            label: tmpl.label,
                            itemType: tmpl.itemType,
                            description: tmpl.description,
                            defaultBoard: tmpl.defaultBoard,
                            throughputGoal: tmpl.throughputGoal,
                          },
                        })
                      }
                      className="text-[10px] font-medium px-2 py-1 rounded border border-[var(--border-color)]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteCustom(tmpl.id)}
                      className="text-[10px] font-medium px-2 py-1 rounded border border-red-500/40 text-red-400/90"
                    >
                      Delete
                    </button>
                    <Link
                      href={`/?agent=friday&panel=wf-templates&edit=${encodeURIComponent(tmpl.id)}`}
                      className="text-[10px] font-medium px-2 py-1 rounded border border-[var(--border-color)] text-[var(--text-secondary)]"
                    >
                      Link
                    </Link>
                  </div>
                ) : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
