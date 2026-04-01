/**
 * Read-only compliance checks: CRM workflows vs WORKFLOW_TYPES ("new model").
 * Safe to run in the browser — does not mutate data or call the database.
 */
import type { WorkflowTypeSpec } from "@/lib/workflow-types";
import { boardStageKeysUpper, parseJsonObject, workflowTypeFromSpec } from "@/lib/workflow-spec";
import {
  inferWorkflowRegistryFromBoardStagesWithCustom,
  resolveWorkflowRegistryIdWithCustom,
  resolveWorkflowTypeFromMaps,
} from "@/lib/workflow-registry";

export type WorkflowComplianceSeverity = "error" | "warn" | "info";

export interface WorkflowComplianceIssue {
  code: string;
  severity: WorkflowComplianceSeverity;
  message: string;
  /** Hint for UI / remediation */
  field?: string;
}

export interface WorkflowModelValidateInput {
  id: string;
  name: string;
  /** Workflow lifecycle: PLANNING | ACTIVE | … */
  lifecycleStage: string;
  spec: unknown;
  itemType: string;
  boardId: string | null;
  ownerAgent: string | null;
  boardStages: unknown;
  boardTransitions: unknown;
  /** Stage key → item count (from CRM aggregates) */
  itemStageCounts?: Record<string, number>;
}

function parseTransitions(raw: unknown): Record<string, string[]> | null {
  if (raw == null) return {};
  let o: unknown = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return null;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const ku = k.trim().toUpperCase();
    if (Array.isArray(v)) {
      out[ku] = v.map((x) => String(x).trim().toUpperCase()).filter(Boolean);
    } else {
      out[ku] = [];
    }
  }
  return out;
}

function normTransitionMap(
  t: Record<string, string[]>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, arr] of Object.entries(t)) {
    out[k.trim().toUpperCase()] = arr.map((x) => x.trim().toUpperCase());
  }
  return out;
}

/**
 * Validates a single workflow snapshot against the merged workflow type registry.
 * Pass optional `customById` from DB when validating server-side with custom types.
 */
export function validateWorkflowAgainstModel(
  input: WorkflowModelValidateInput,
  customById: Map<string, WorkflowTypeSpec> = new Map()
): WorkflowComplianceIssue[] {
  const issues: WorkflowComplianceIssue[] = [];
  const boardKeys = boardStageKeysUpper(input.boardStages);
  const boardKeySet = new Set(boardKeys);
  const transitions = parseTransitions(input.boardTransitions);
  const rawSpecType = workflowTypeFromSpec(input.spec);
  const specResolved = resolveWorkflowRegistryIdWithCustom(rawSpecType, customById);
  const inferred = inferWorkflowRegistryFromBoardStagesWithCustom(
    input.boardStages,
    customById.values()
  );

  if (!input.boardId) {
    issues.push({
      code: "NO_BOARD_ID",
      severity: "error",
      message: "Workflow has no boardId — attach a board before running pipeline items.",
      field: "boardId",
    });
  } else if (boardKeys.length === 0) {
    issues.push({
      code: "ORPHAN_OR_EMPTY_BOARD",
      severity: "error",
      message:
        "Board is missing, deleted, or has no stages in JSON — Kanban and resolve logic cannot trust stage keys.",
      field: "board",
    });
  }

  if (rawSpecType && !specResolved) {
    issues.push({
      code: "UNKNOWN_SPEC_WORKFLOW_TYPE",
      severity: "error",
      message: `spec.workflowType "${rawSpecType}" does not match any known workflow type id.`,
      field: "spec.workflowType",
    });
  }

  if (!specResolved && !inferred) {
    if (boardKeys.length > 0) {
      issues.push({
        code: "UNRESOLVED_REGISTRY_TYPE",
        severity: "error",
        message:
          "Could not resolve a registry type from spec or from an exact default board stage match. Human-tasks / resolve may mis-label this workflow.",
        field: "spec.workflowType",
      });
    }
  } else if (specResolved && inferred && specResolved !== inferred) {
    issues.push({
      code: "SPEC_TYPE_VS_BOARD_SHAPE",
      severity: "warn",
      message: `spec says "${specResolved}" but board stage set matches registry "${inferred}". Align spec.workflowType with the board template.`,
      field: "spec.workflowType",
    });
  } else if (!rawSpecType && inferred) {
    issues.push({
      code: "MISSING_WORKFLOW_TYPE_IN_SPEC",
      severity: "info",
      message: `Registry type can be inferred as "${inferred}" from the board. Set spec.workflowType explicitly for stable tooling.`,
      field: "spec.workflowType",
    });
  }

  const registryId = specResolved || inferred;
  const reg: WorkflowTypeSpec | undefined = registryId
    ? resolveWorkflowTypeFromMaps(registryId, customById)
    : undefined;

  if (reg) {
    const expectedItem = reg.itemType;
    const actualItem = (input.itemType || "person").toLowerCase();
    if (actualItem !== expectedItem) {
      issues.push({
        code: "ITEM_TYPE_MISMATCH",
        severity: "error",
        message: `Registry "${registryId}" expects itemType "${expectedItem}" but workflow has "${actualItem}".`,
        field: "itemType",
      });
    }

    const defKeys = reg.defaultBoard.stages.map((s) => s.key.trim().toUpperCase());
    const defSet = new Set(defKeys);
    const missingFromBoard = defKeys.filter((k) => !boardKeySet.has(k));
    const extraOnBoard = boardKeys.filter((k) => !defSet.has(k));
    if (missingFromBoard.length > 0 && boardKeys.length > 0) {
      issues.push({
        code: "BOARD_MISSING_MODEL_STAGES",
        severity: "warn",
        message: `Board is missing stage keys present in the "${registryId}" template: ${missingFromBoard.join(", ")}.`,
        field: "board.stages",
      });
    }
    if (extraOnBoard.length > 0) {
      issues.push({
        code: "BOARD_EXTRA_STAGES",
        severity: "info",
        message: `Board has stages not in the "${registryId}" template: ${extraOnBoard.join(", ")}. May be intentional customization.`,
        field: "board.stages",
      });
    }

    const defT = normTransitionMap(reg.defaultBoard.transitions);
    if (transitions === null) {
      issues.push({
        code: "TRANSITIONS_PARSE_ERROR",
        severity: "warn",
        message: "Board transitions JSON could not be parsed — check invalid JSON in _board.transitions.",
        field: "board.transitions",
      });
    } else if (
      boardKeySet.size > 0 &&
      Object.keys(transitions).length === 0 &&
      Object.keys(defT).length > 0
    ) {
      issues.push({
        code: "BOARD_TRANSITIONS_EMPTY",
        severity: "warn",
        message: `Board has stages but transitions object is empty — expected edges for "${registryId}" template.`,
        field: "board.transitions",
      });
    } else if (boardKeySet.size > 0) {
      for (const [from, targets] of Object.entries(transitions)) {
        if (!boardKeySet.has(from)) {
          issues.push({
            code: "TRANSITION_UNKNOWN_SOURCE",
            severity: "error",
            message: `Transition source "${from}" is not a board stage.`,
            field: "board.transitions",
          });
        }
        for (const to of targets) {
          if (!boardKeySet.has(to)) {
            issues.push({
              code: "TRANSITION_UNKNOWN_TARGET",
              severity: "error",
              message: `Transition ${from} → ${to}: target is not a board stage.`,
              field: "board.transitions",
            });
          }
        }
      }

      const actualNorm = normTransitionMap(transitions);
      const templateKeys = new Set(Object.keys(defT));
      const actualKeys = new Set(Object.keys(actualNorm));
      const keysOnlyInTemplate = [...templateKeys].filter((k) => !actualKeys.has(k));
      const keysOnlyInActual = [...actualKeys].filter((k) => !templateKeys.has(k));
      let edgeMismatch = false;
      for (const k of [...templateKeys].filter((x) => actualKeys.has(x))) {
        const a = [...(actualNorm[k] || [])].sort().join(",");
        const b = [...(defT[k] || [])].sort().join(",");
        if (a !== b) edgeMismatch = true;
      }
      if (
        (keysOnlyInTemplate.length > 0 || keysOnlyInActual.length > 0 || edgeMismatch) &&
        missingFromBoard.length === 0 &&
        extraOnBoard.length === 0
      ) {
        issues.push({
          code: "TRANSITION_GRAPH_DRIFT",
          severity: "info",
          message: `Transition graph differs from "${registryId}" template (edges or keys). Verify intentional if this workflow was customized.`,
          field: "board.transitions",
        });
      }
    }
  } else if (transitions === null && boardKeys.length > 0) {
    issues.push({
      code: "TRANSITIONS_PARSE_ERROR",
      severity: "warn",
      message: "Board transitions JSON could not be parsed.",
      field: "board.transitions",
    });
  } else if (boardKeySet.size > 0 && transitions !== null) {
    for (const [from, targets] of Object.entries(transitions)) {
      if (!boardKeySet.has(from)) {
        issues.push({
          code: "TRANSITION_UNKNOWN_SOURCE",
          severity: "error",
          message: `Transition source "${from}" is not a board stage.`,
          field: "board.transitions",
        });
      }
      for (const to of targets) {
        if (!boardKeySet.has(to)) {
          issues.push({
            code: "TRANSITION_UNKNOWN_TARGET",
            severity: "error",
            message: `Transition ${from} → ${to}: target is not a board stage.`,
            field: "board.transitions",
          });
        }
      }
    }
  }

  const counts = input.itemStageCounts || {};
  for (const [stageKey, n] of Object.entries(counts)) {
    if (!n || n <= 0) continue;
    const u = stageKey.trim().toUpperCase();
    if (boardKeySet.size > 0 && !boardKeySet.has(u)) {
      issues.push({
        code: "ITEMS_ON_UNKNOWN_STAGE",
        severity: "error",
        message: `${n} item(s) on stage "${stageKey}" which is not on the workflow board — data repair needed.`,
        field: "_workflow_item.stage",
      });
    }
  }

  const lc = (input.lifecycleStage || "").trim().toUpperCase();
  const totalItems = Object.values(counts).reduce((a, b) => a + b, 0);
  if (lc === "PLANNING" && totalItems > 0) {
    issues.push({
      code: "LIFECYCLE_VS_ITEMS",
      severity: "warn",
      message: `Workflow lifecycle is PLANNING but ${totalItems} pipeline item(s) exist — consider ACTIVE when ready.`,
      field: "workflow.stage",
    });
  }

  const specObj = parseJsonObject(input.spec);
  if (specObj && Object.keys(specObj).length === 0 && boardKeys.length > 0) {
    issues.push({
      code: "EMPTY_SPEC_OBJECT",
      severity: "info",
      message: "spec is empty — add workflowType (and other metadata) for clearer registry resolution.",
      field: "spec",
    });
  }

  return issues;
}

export function worstSeverity(
  issues: WorkflowComplianceIssue[]
): WorkflowComplianceSeverity | null {
  if (issues.some((i) => i.severity === "error")) return "error";
  if (issues.some((i) => i.severity === "warn")) return "warn";
  if (issues.some((i) => i.severity === "info")) return "info";
  return null;
}
