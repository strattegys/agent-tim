/**
 * Merge built-in WORKFLOW_TYPES with Postgres `_workflow_type_custom` rows.
 * v1: custom `id` must not collide with a built-in key (enforced on save).
 */

import { query } from "@/lib/db";
import {
  WORKFLOW_TYPES,
  type WorkflowThroughputGoalSpec,
  type WorkflowTypeSpec,
  workflowTypesWithThroughputGoals,
} from "@/lib/workflow-types";
import { buildWorkflowTypeSpecFromCustomRow } from "@/lib/workflow-type-definition-validate";
import {
  boardStageKeysUpper,
  inferWorkflowRegistryFromBoardStages,
  parseJsonObject,
  resolveWorkflowRegistryId,
  workflowTypeFromSpec,
} from "@/lib/workflow-spec";
import type { PackageDeliverable } from "@/lib/package-types";

type CustomRow = {
  id: string;
  label: string;
  itemType: string;
  description: string;
  defaultBoard: unknown;
  throughputGoal: unknown | null;
};

export function isBuiltinWorkflowTypeId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(WORKFLOW_TYPES, id);
}

export function builtinWorkflowTypeIds(): string[] {
  return Object.keys(WORKFLOW_TYPES);
}

/** Load active custom definitions from CRM. */
export async function loadCustomWorkflowTypeMap(): Promise<Map<string, WorkflowTypeSpec>> {
  let rows: CustomRow[];
  try {
    rows = await query<CustomRow>(
      `SELECT id, label, "itemType", description, "defaultBoard", "throughputGoal"
       FROM "_workflow_type_custom"
       WHERE "deletedAt" IS NULL`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/relation "_workflow_type_custom"/i.test(msg) || /does not exist/i.test(msg)) {
      console.warn("[workflow-registry] _workflow_type_custom missing — run migrate-workflow-type-custom.sql");
      return new Map();
    }
    throw e;
  }
  const m = new Map<string, WorkflowTypeSpec>();
  for (const row of rows) {
    try {
      m.set(
        row.id,
        buildWorkflowTypeSpecFromCustomRow({
          ...row,
          throughputGoal: row.throughputGoal ?? undefined,
        })
      );
    } catch (err) {
      console.warn("[workflow-registry] skip invalid custom row", row.id, err);
    }
  }
  return m;
}

export function resolveWorkflowTypeFromMaps(
  id: string,
  customById: Map<string, WorkflowTypeSpec>
): WorkflowTypeSpec | undefined {
  return customById.get(id) ?? WORKFLOW_TYPES[id];
}

/** Resolve stored workflowType string to a registry id, including custom types. */
export function resolveWorkflowRegistryIdWithCustom(
  raw: string | undefined | null,
  customById: Map<string, WorkflowTypeSpec>
): string | null {
  const builtin = resolveWorkflowRegistryId(raw);
  if (builtin) return builtin;
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/^\uFEFF/, "");
  if (!t) return null;
  if (customById.has(t)) return t;
  const kebab = t.replace(/_/g, "-");
  if (customById.has(kebab)) return kebab;
  const lower = t.toLowerCase();
  for (const id of customById.keys()) {
    if (id.toLowerCase() === lower) return id;
  }
  const spacedKebab = lower.replace(/\s+/g, "-");
  for (const id of customById.keys()) {
    if (id.toLowerCase() === spacedKebab) return id;
  }
  for (const [id, spec] of customById) {
    const lab = spec.label?.trim().toLowerCase();
    if (lab === lower) return id;
  }
  return null;
}

export function inferWorkflowRegistryFromBoardStagesWithCustom(
  boardStages: unknown,
  customSpecs: Iterable<WorkflowTypeSpec>
): string | null {
  const fromBuiltin = inferWorkflowRegistryFromBoardStages(boardStages);
  if (fromBuiltin) return fromBuiltin;
  const keys = boardStageKeysUpper(boardStages);
  if (keys.length === 0) return null;
  const norm = [...new Set(keys)].sort().join("\0");
  for (const spec of customSpecs) {
    const defKeys = spec.defaultBoard.stages.map((s) => s.key.trim().toUpperCase());
    const defNorm = [...new Set(defKeys)].sort().join("\0");
    if (norm === defNorm) return spec.id;
  }
  return null;
}

export function resolveWorkflowRegistryForQueueWithCustomMap(
  workflowSpec: unknown,
  opts: {
    packageSpec?: unknown;
    ownerAgent?: string | null;
    boardStages?: unknown;
  },
  customMap: Map<string, WorkflowTypeSpec>
): string | null {
  const customList = [...customMap.values()];
  const fromSpec = resolveWorkflowRegistryIdWithCustom(workflowTypeFromSpec(workflowSpec), customMap);
  if (fromSpec) return fromSpec;

  const pkg = opts.packageSpec != null ? parseJsonObject(opts.packageSpec) : null;
  const dels = pkg?.deliverables;
  if (Array.isArray(dels)) {
    const ownerNorm = String(opts.ownerAgent || "").trim().toLowerCase();
    for (const d of dels) {
      if (!d || typeof d !== "object") continue;
      const oa = String((d as PackageDeliverable).ownerAgent || "").trim().toLowerCase();
      if (ownerNorm && oa === ownerNorm) {
        const wt = (d as PackageDeliverable).workflowType;
        const rid = resolveWorkflowRegistryIdWithCustom(typeof wt === "string" ? wt : undefined, customMap);
        if (rid) return rid;
      }
    }
    if (dels.length === 1) {
      const wt = (dels[0] as PackageDeliverable).workflowType;
      const rid = resolveWorkflowRegistryIdWithCustom(typeof wt === "string" ? wt : undefined, customMap);
      if (rid) return rid;
    }
  }

  return inferWorkflowRegistryFromBoardStagesWithCustom(opts.boardStages, customList);
}

export async function resolveWorkflowRegistryForQueueWithCustom(
  workflowSpec: unknown,
  opts: {
    packageSpec?: unknown;
    ownerAgent?: string | null;
    boardStages?: unknown;
  }
): Promise<string | null> {
  const customMap = await loadCustomWorkflowTypeMap();
  return resolveWorkflowRegistryForQueueWithCustomMap(workflowSpec, opts, customMap);
}

export async function getWorkflowTypeRegistry(): Promise<{
  get: (id: string) => WorkflowTypeSpec | undefined;
  listAll: () => WorkflowTypeSpec[];
  customIds: () => string[];
}> {
  const custom = await loadCustomWorkflowTypeMap();
  return {
    get: (id: string) => resolveWorkflowTypeFromMaps(id, custom),
    listAll: () => {
      const out: WorkflowTypeSpec[] = [...Object.values(WORKFLOW_TYPES)];
      const seen = new Set(out.map((w) => w.id));
      for (const w of custom.values()) {
        if (!seen.has(w.id)) {
          seen.add(w.id);
          out.push(w);
        }
      }
      return out;
    },
    customIds: () => [...custom.keys()],
  };
}

export async function getWorkflowType(id: string): Promise<WorkflowTypeSpec | undefined> {
  const reg = await getWorkflowTypeRegistry();
  return reg.get(id);
}

export async function listAllWorkflowTypeIds(): Promise<string[]> {
  const reg = await getWorkflowTypeRegistry();
  return reg.listAll().map((w) => w.id);
}

/** Built-ins + custom rows that define throughputGoal (Friday Goals). */
export async function workflowTypesWithThroughputGoalsMerged(): Promise<
  Array<{ id: string; label: string; throughputGoal: WorkflowThroughputGoalSpec }>
> {
  const builtins = workflowTypesWithThroughputGoals();
  const builtinGoalIds = new Set(builtins.map((b) => b.id));
  const customMap = await loadCustomWorkflowTypeMap();
  /** Custom `throughputGoal` is ignored when the same id already has a built-in goal (code is source of truth). */
  const extra = [...customMap.values()]
    .filter((w) => w.throughputGoal && !builtinGoalIds.has(w.id))
    .map((w) => ({
      id: w.id,
      label: w.label,
      throughputGoal: w.throughputGoal!,
    }));
  /** Reply-to-close never has a throughput *target* (opener-driven); still measured via API `measures`. */
  return [...builtins, ...extra].filter((row) => row.id !== "reply-to-close");
}
