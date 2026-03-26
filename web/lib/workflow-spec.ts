/**
 * Parse workflow JSON spec from DB (jsonb or string) and resolve registry ids.
 */
import { WORKFLOW_TYPES } from "@/lib/workflow-types";

export function parseJsonObject(spec: unknown): Record<string, unknown> | null {
  if (spec == null) return null;
  let o: unknown = spec;
  if (typeof spec === "string") {
    try {
      o = JSON.parse(spec) as unknown;
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  return o as Record<string, unknown>;
}

/** workflowType from spec (supports workflow_type alias). */
export function workflowTypeFromSpec(spec: unknown): string | undefined {
  const o = parseJsonObject(spec);
  if (!o) return undefined;
  const w = o.workflowType ?? o.workflow_type;
  return typeof w === "string" ? w.trim() : undefined;
}

/** Map stored workflowType string to a key in WORKFLOW_TYPES. */
export function resolveWorkflowRegistryId(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/^\uFEFF/, "");
  if (!t) return null;
  if (WORKFLOW_TYPES[t]) return t;
  const kebab = t.replace(/_/g, "-");
  if (WORKFLOW_TYPES[kebab]) return kebab;
  const lower = t.toLowerCase();
  if (WORKFLOW_TYPES[lower]) return lower;
  const lowerKebab = kebab.toLowerCase();
  if (WORKFLOW_TYPES[lowerKebab]) return lowerKebab;
  for (const id of Object.keys(WORKFLOW_TYPES)) {
    if (id.toLowerCase() === lower || id.toLowerCase() === lowerKebab) return id;
  }
  // "Warm Outreach" → warm-outreach (spaces to kebab)
  const spacedKebab = lower.replace(/\s+/g, "-");
  if (WORKFLOW_TYPES[spacedKebab]) return spacedKebab;
  // Display labels stored in DB instead of registry id
  for (const [id, spec] of Object.entries(WORKFLOW_TYPES)) {
    const lab = (spec as { label?: string }).label;
    if (typeof lab === "string" && lab.trim().toLowerCase() === lower) return id;
  }
  return null;
}

function boardStageKeysUpper(boardStages: unknown): string[] {
  if (boardStages == null) return [];
  let arr: unknown = boardStages;
  if (typeof boardStages === "string") {
    try {
      arr = JSON.parse(boardStages) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const keys: string[] = [];
  for (const s of arr) {
    if (s && typeof s === "object" && !Array.isArray(s) && typeof (s as { key?: string }).key === "string") {
      keys.push((s as { key: string }).key.trim().toUpperCase());
    }
  }
  return keys;
}

/**
 * When workflow.spec.workflowType is missing or malformed, infer registry id from
 * the board’s stage list (exact key-set match to a default board).
 */
export function inferWorkflowRegistryFromBoardStages(boardStages: unknown): string | null {
  const keys = boardStageKeysUpper(boardStages);
  if (keys.length === 0) return null;
  const norm = [...new Set(keys)].sort().join("\0");
  for (const [typeId, spec] of Object.entries(WORKFLOW_TYPES)) {
    const defKeys = spec.defaultBoard.stages.map((s) => s.key.trim().toUpperCase());
    const defNorm = [...new Set(defKeys)].sort().join("\0");
    if (norm === defNorm) return typeId;
  }
  return null;
}

/**
 * Resolve WORKFLOW_TYPES id for human-tasks and similar: spec first, then package
 * deliverables (owner match or single-deliverable package), then board shape.
 */
export function resolveWorkflowRegistryForQueue(
  workflowSpec: unknown,
  opts: {
    packageSpec?: unknown;
    ownerAgent?: string | null;
    boardStages?: unknown;
  }
): string | null {
  const fromSpec = resolveWorkflowRegistryId(workflowTypeFromSpec(workflowSpec));
  if (fromSpec) return fromSpec;

  const pkg = opts.packageSpec != null ? parseJsonObject(opts.packageSpec) : null;
  const dels = pkg?.deliverables;
  if (Array.isArray(dels)) {
    const ownerNorm = String(opts.ownerAgent || "").trim().toLowerCase();
    for (const d of dels) {
      if (!d || typeof d !== "object") continue;
      const oa = String((d as { ownerAgent?: string }).ownerAgent || "").trim().toLowerCase();
      if (ownerNorm && oa === ownerNorm) {
        const wt = (d as { workflowType?: string }).workflowType;
        const rid = resolveWorkflowRegistryId(typeof wt === "string" ? wt : undefined);
        if (rid) return rid;
      }
    }
    if (dels.length === 1) {
      const wt = (dels[0] as { workflowType?: string }).workflowType;
      const rid = resolveWorkflowRegistryId(typeof wt === "string" ? wt : undefined);
      if (rid) return rid;
    }
  }

  return inferWorkflowRegistryFromBoardStages(opts.boardStages);
}
