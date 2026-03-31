"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { panelBus } from "@/lib/events";

type BoardStage = { key?: string; label?: string };

type WorkflowOption = {
  id: string;
  name: string;
  stage: string;
  itemType: string;
  ownerAgent: string | null;
  packageId: string | null;
  packageName: string | null;
  packageNumber: number | null;
  spec: string;
  board: {
    stages?: unknown;
  } | null;
};

function parseStageOptions(board: WorkflowOption["board"]): { key: string; label: string }[] {
  const raw = board?.stages;
  if (!Array.isArray(raw)) return [];
  const out: { key: string; label: string }[] = [];
  for (const s of raw) {
    const o = s as BoardStage;
    const k = typeof o.key === "string" ? o.key.trim() : "";
    if (!k) continue;
    const lab = typeof o.label === "string" && o.label.trim() ? o.label.trim() : k;
    out.push({ key: k, label: lab });
  }
  return out;
}

function isTimMoveTargetWorkflow(w: WorkflowOption): boolean {
  if ((w.itemType || "").toLowerCase() !== "person") return false;
  if ((w.ownerAgent || "").trim().toLowerCase() !== "tim") return false;
  if ((w.stage || "").trim().toUpperCase() !== "ACTIVE") return false;
  const spec = typeof w.spec === "string" ? w.spec : JSON.stringify(w.spec ?? "");
  if (spec.includes("linkedin-general-inbox") || spec.includes("linkedin-connection-intake")) {
    return false;
  }
  return true;
}

export type TimMoveSelection = { workflowId: string; stageKey: string };

interface TimMoveToWorkflowProps {
  /** Person row id */
  personId: string;
  /** Current queue `_workflow_item.id` — sent as closeIntakeItemId */
  intakeItemId: string;
  onMoved?: () => void;
  /**
   * collapsible: toggle + inline card (default).
   * dialog: form only — use inside a parent modal.
   */
  variant?: "collapsible" | "dialog";
  /** Fires when target workflow or stage changes (for gating other actions). */
  onSelectionChange?: (sel: TimMoveSelection) => void;
  /** When this value changes, clears workflow/stage selection (e.g. workflow item id). */
  selectionResetKey?: string;
}

export default function TimMoveToWorkflow({
  personId,
  intakeItemId,
  onMoved,
  variant = "collapsible",
  onSelectionChange,
  selectionResetKey,
}: TimMoveToWorkflowProps) {
  const [open, setOpen] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [workflowId, setWorkflowId] = useState("");
  const [stageKey, setStageKey] = useState("");
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isDialog = variant === "dialog";

  const targets = useMemo(() => workflows.filter(isTimMoveTargetWorkflow), [workflows]);

  const selectedWf = useMemo(
    () => targets.find((w) => w.id === workflowId) ?? null,
    [targets, workflowId]
  );
  const stageOptions = useMemo(() => parseStageOptions(selectedWf?.board ?? null), [selectedWf]);

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const r = await fetch("/api/crm/workflows?agent=tim", { credentials: "include" });
      const d = (await r.json().catch(() => ({}))) as {
        workflows?: WorkflowOption[];
        error?: string;
      };
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setWorkflows(Array.isArray(d.workflows) ? d.workflows : []);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Failed to load workflows");
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isDialog || open) void loadWorkflows();
  }, [isDialog, open, loadWorkflows]);

  useEffect(() => {
    if (!workflowId || !selectedWf) {
      setStageKey("");
      return;
    }
    const opts = parseStageOptions(selectedWf.board);
    setStageKey((prev) => {
      if (prev && opts.some((o) => o.key === prev)) return prev;
      return opts[0]?.key ?? "";
    });
  }, [workflowId, selectedWf]);

  const prevResetKeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selectionResetKey === undefined) return;
    if (prevResetKeyRef.current === selectionResetKey) return;
    prevResetKeyRef.current = selectionResetKey;
    setWorkflowId("");
    setStageKey("");
    setSubmitErr(null);
  }, [selectionResetKey]);

  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  useEffect(() => {
    onSelectionChangeRef.current?.({ workflowId, stageKey });
  }, [workflowId, stageKey]);

  const submit = async () => {
    if (!workflowId || !stageKey) {
      setSubmitErr("Choose a workflow and stage.");
      return;
    }
    setBusy(true);
    setSubmitErr(null);
    try {
      const r = await fetch("/api/crm/workflow-items", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId,
          sourceType: "person",
          sourceId: personId,
          stage: stageKey,
          closeIntakeItemId: intakeItemId,
        }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      panelBus.emit("tim_human_task_progress");
      panelBus.emit("dashboard_sync");
      if (!isDialog) setOpen(false);
      onMoved?.();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : "Move failed");
    } finally {
      setBusy(false);
    }
  };

  const showBody = isDialog || open;

  const outerClass = isDialog
    ? "space-y-3"
    : "shrink-0 mb-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2";

  const innerClass = isDialog ? "space-y-3" : "mt-2 space-y-2";

  const fieldBlockClass = "block";
  const selectClass =
    "mt-0.5 w-full text-[11px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1.5 text-[var(--text-primary)]";

  return (
    <div className={outerClass}>
      {!isDialog ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-[11px] font-medium text-[var(--accent-green)] hover:underline"
          >
            {open ? "▼ Hide" : "▶ Move to workflow"}
          </button>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1 leading-snug">
            Add this person to an active Tim package pipeline, then remove this intake row.
          </p>
        </>
      ) : null}
      {showBody ? (
        <div className={innerClass}>
          {loadErr ? (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">{loadErr}</p>
          ) : null}
          {loading ? (
            <p className="text-[10px] text-[var(--text-tertiary)]">Loading workflows…</p>
          ) : targets.length === 0 ? (
            <p className="text-[10px] text-[var(--text-tertiary)]">
              No active Tim person workflows (excluding LinkedIn intake). Activate a package or create a workflow first.
            </p>
          ) : (
            <>
              <label className={fieldBlockClass}>
                <span className="text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">
                  Target workflow
                </span>
                <select
                  value={workflowId}
                  onChange={(e) => setWorkflowId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select…</option>
                  {targets.map((w) => {
                    const pkg =
                      w.packageNumber != null && !Number.isNaN(w.packageNumber)
                        ? `#${w.packageNumber} `
                        : "";
                    const pnm = w.packageName?.trim() || "";
                    const suffix = pnm ? `${pkg}${pnm} · ` : pkg ? `${pkg}· ` : "";
                    return (
                      <option key={w.id} value={w.id}>
                        {suffix}
                        {w.name}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className={fieldBlockClass}>
                <span className="text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">
                  Stage (board)
                </span>
                <select
                  value={stageKey}
                  onChange={(e) => setStageKey(e.target.value)}
                  disabled={!workflowId || stageOptions.length === 0}
                  className={`${selectClass} disabled:opacity-50`}
                >
                  {stageOptions.length === 0 ? (
                    <option value="">No stages</option>
                  ) : (
                    stageOptions.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label} ({s.key})
                      </option>
                    ))
                  )}
                </select>
              </label>
              {submitErr ? (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">{submitErr}</p>
              ) : null}
              <button
                type="button"
                disabled={busy || !workflowId || !stageKey}
                onClick={() => void submit()}
                className="text-[11px] font-medium rounded-md bg-[var(--accent-green)]/90 px-3 py-1.5 text-white hover:bg-[var(--accent-green)] disabled:opacity-50 w-full sm:w-auto"
              >
                {busy ? "Moving…" : "Move and close intake"}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
