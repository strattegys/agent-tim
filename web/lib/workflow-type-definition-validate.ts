/**
 * Validates custom workflow type payloads (stages + transitions) before DB/API persist.
 * Mirrors constraints expected by Kanban and package activation.
 */

import type { StageSpec, WorkflowThroughputGoalSpec, WorkflowTypeSpec } from "@/lib/workflow-types";

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Normalize transitions: keys may be mixed case; values are stage keys. */
export function parseDefaultBoard(raw: unknown): {
  stages: StageSpec[];
  transitions: Record<string, string[]>;
} | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const stagesRaw = o.stages;
  const transRaw = o.transitions;
  if (!Array.isArray(stagesRaw)) return null;
  const stages: StageSpec[] = [];
  for (const s of stagesRaw) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return null;
    const r = s as Record<string, unknown>;
    if (!isNonEmptyString(r.key) || !isNonEmptyString(r.label) || !isNonEmptyString(r.color)) return null;
    stages.push({
      key: String(r.key).trim(),
      label: String(r.label).trim(),
      color: String(r.color).trim(),
      instructions: isNonEmptyString(r.instructions) ? String(r.instructions) : "",
      requiresHuman: Boolean(r.requiresHuman),
      humanAction: typeof r.humanAction === "string" ? r.humanAction : undefined,
    });
  }
  const transitions: Record<string, string[]> = {};
  if (transRaw != null && typeof transRaw === "object" && !Array.isArray(transRaw)) {
    for (const [k, v] of Object.entries(transRaw as Record<string, unknown>)) {
      const key = k.trim();
      if (!key) continue;
      if (!Array.isArray(v)) return null;
      transitions[key] = v.map((x) => String(x).trim()).filter(Boolean);
    }
  }
  return { stages, transitions };
}

export function validateDefaultBoard(board: {
  stages: StageSpec[];
  transitions: Record<string, string[]>;
}): ValidationResult {
  const errors: string[] = [];
  if (board.stages.length === 0) {
    errors.push("At least one stage is required.");
  }
  const keys = board.stages.map((s) => s.key.trim());
  const keySet = new Set<string>();
  for (const k of keys) {
    const u = k.toUpperCase();
    if (keySet.has(u)) errors.push(`Duplicate stage key (case-insensitive): ${k}`);
    keySet.add(u);
  }
  const keyLookup = new Set(keys.map((k) => k.toUpperCase()));
  for (const s of board.stages) {
    if (!s.label.trim()) errors.push(`Stage ${s.key}: label is required.`);
    if (!s.color.trim()) errors.push(`Stage ${s.key}: color is required.`);
  }
  for (const [from, tos] of Object.entries(board.transitions)) {
    const fromU = from.trim();
    if (!keyLookup.has(fromU.toUpperCase())) {
      errors.push(`Transition source "${from}" is not a stage key.`);
      continue;
    }
    for (const t of tos) {
      if (!keyLookup.has(t.toUpperCase())) {
        errors.push(`Transition ${from} → ${t}: target is not a stage key.`);
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

export function validateThroughputGoal(raw: unknown): ValidationResult {
  if (raw == null) return { ok: true };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["throughputGoal must be a JSON object or null."] };
  }
  const o = raw as Record<string, unknown>;
  const period = o.period;
  const metric = o.metric;
  const target = o.target;
  if (period !== "day" && period !== "week") {
    return { ok: false, errors: ['throughputGoal.period must be "day" or "week".'] };
  }
  if (metric !== "warm_outreach_dm_sent" && metric !== "content_article_published") {
    return {
      ok: false,
      errors: [
        "throughputGoal.metric must be warm_outreach_dm_sent or content_article_published.",
      ],
    };
  }
  if (typeof target !== "number" || !Number.isFinite(target) || target < 0) {
    return { ok: false, errors: ["throughputGoal.target must be a non-negative number."] };
  }
  if (!isNonEmptyString(o.ownerLabel)) {
    return { ok: false, errors: ["throughputGoal.ownerLabel is required."] };
  }
  if (!isNonEmptyString(o.metricLabel)) {
    return { ok: false, errors: ["throughputGoal.metricLabel is required."] };
  }
  return { ok: true };
}

export function validateCustomWorkflowTypePayload(input: {
  id: string;
  label: string;
  itemType: string;
  description: string;
  defaultBoard: unknown;
  throughputGoal?: unknown;
}): ValidationResult {
  const errors: string[] = [];
  if (!isNonEmptyString(input.id)) errors.push("id is required (slug).");
  else if (!/^[a-z][a-z0-9-]*$/.test(input.id.trim())) {
    errors.push("id must be lowercase, start with a letter, and use only letters, numbers, and hyphens.");
  }
  if (!isNonEmptyString(input.label)) errors.push("label is required.");
  if (input.itemType !== "person" && input.itemType !== "content") {
    errors.push('itemType must be "person" or "content".');
  }
  const board = parseDefaultBoard(input.defaultBoard);
  if (!board) {
    errors.push("defaultBoard must be an object with stages[] and optional transitions{}.");
  } else {
    const br = validateDefaultBoard(board);
    if (!br.ok) errors.push(...br.errors);
  }
  const tg = validateThroughputGoal(input.throughputGoal ?? null);
  if (!tg.ok) errors.push(...tg.errors);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

export function buildWorkflowTypeSpecFromCustomRow(row: {
  id: string;
  label: string;
  itemType: string;
  description: string;
  defaultBoard: unknown;
  throughputGoal?: unknown;
}): WorkflowTypeSpec {
  const board = parseDefaultBoard(row.defaultBoard);
  if (!board || validateDefaultBoard(board).ok === false) {
    throw new Error("Invalid defaultBoard in row");
  }
  let throughputGoal: WorkflowThroughputGoalSpec | undefined;
  if (row.throughputGoal != null && typeof row.throughputGoal === "object" && !Array.isArray(row.throughputGoal)) {
    const t = row.throughputGoal as Record<string, unknown>;
    throughputGoal = {
      period: t.period as "day" | "week",
      target: Number(t.target) || 0,
      metric: t.metric as WorkflowThroughputGoalSpec["metric"],
      ownerLabel: String(t.ownerLabel || ""),
      metricLabel: String(t.metricLabel || ""),
    };
  }
  return {
    id: row.id.trim(),
    label: row.label.trim(),
    itemType: row.itemType as "person" | "content",
    description: String(row.description || ""),
    defaultBoard: board,
    ...(throughputGoal ? { throughputGoal } : {}),
  };
}
