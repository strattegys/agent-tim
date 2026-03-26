import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { DEFAULT_WARM_OUTREACH_DISCOVERY } from "@/lib/warm-outreach-discovery";
import { PACKAGE_TEMPLATES, type PackageDeliverable } from "@/lib/package-types";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";
import {
  parseJsonObject,
  workflowTypeFromSpec,
  resolveWorkflowRegistryId,
} from "@/lib/workflow-spec";

/**
 * Packages API — CRUD for service packages.
 *
 * GET  ?stage=&customerId=&operational=true&includeStats=true&includeWorkflowBreakdown=true
 *      operational=true → stage IN (ACTIVE, PAUSED, COMPLETED) for Friday ops board
 *      includeStats=true → total workflow items across package workflows
 *      includeWorkflowBreakdown=true → per-workflow pipeline stages + item counts per stage (Friday cards)
 * POST {templateId, name, customerId?, customerType?, spec?} — Create package
 * PATCH {id, stage?, spec?, name?} — Update package
 */

interface WorkflowBreakdownStage {
  key: string;
  label: string;
  color: string;
  /** Human step (planner-style icon) — from WORKFLOW_TYPES when known */
  requiresHuman?: boolean;
}

interface WorkflowBreakdownRow {
  id: string;
  name: string;
  ownerAgent: string;
  workflowType: string;
  targetCount: number;
  /** Package/template line e.g. "Five messages per day" — prefer over raw targetCount in UI */
  volumeLabel: string | null;
  totalItems: number;
  stageCounts: Record<string, number>;
  stages: WorkflowBreakdownStage[];
}

function parseWorkflowSpec(spec: unknown): {
  workflowType?: string;
  targetCount?: number;
} {
  const o = parseJsonObject(spec);
  if (!o) return {};
  return {
    workflowType: workflowTypeFromSpec(spec),
    targetCount: typeof o.targetCount === "number" ? o.targetCount : 0,
  };
}

function deliverableMetaForWorkflow(
  packageSpecRaw: unknown,
  templateId: string,
  registryWorkflowType: string
): { volumeLabel?: string; templateTarget?: number } {
  const o = parseJsonObject(packageSpecRaw);
  const arr = o?.deliverables;
  let fromPkg: PackageDeliverable | undefined;
  if (Array.isArray(arr)) {
    fromPkg = arr.find(
      (d) =>
        d &&
        typeof d === "object" &&
        String((d as PackageDeliverable).workflowType) === registryWorkflowType
    ) as PackageDeliverable | undefined;
  }
  const tmpl = PACKAGE_TEMPLATES[templateId];
  const fromTmpl = tmpl?.deliverables.find((d) => d.workflowType === registryWorkflowType);
  return {
    volumeLabel: fromPkg?.volumeLabel || fromTmpl?.volumeLabel,
    templateTarget:
      typeof fromPkg?.targetCount === "number" ? fromPkg.targetCount : fromTmpl?.targetCount,
  };
}

function enrichStagesHuman(
  stages: WorkflowBreakdownStage[],
  registryId: string
): WorkflowBreakdownStage[] {
  const def = WORKFLOW_TYPES[registryId]?.defaultBoard?.stages;
  return stages.map((s) => {
    const match = def?.find((d) => d.key.toUpperCase() === s.key.toUpperCase());
    return {
      ...s,
      requiresHuman: Boolean(match?.requiresHuman && match?.humanAction),
    };
  });
}

function parseBoardStagesJson(raw: unknown): WorkflowBreakdownStage[] {
  if (raw == null) return [];
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
    .filter((s) => typeof s.key === "string")
    .map((s) => ({
      key: s.key as string,
      label: typeof s.label === "string" ? (s.label as string) : (s.key as string),
      color: typeof s.color === "string" ? (s.color as string) : "#64748b",
    }));
}

function stagesForWorkflow(
  boardStages: WorkflowBreakdownStage[],
  workflowType: string
): WorkflowBreakdownStage[] {
  if (boardStages.length > 0) return boardStages;
  const def = WORKFLOW_TYPES[workflowType]?.defaultBoard?.stages;
  if (!def?.length) return [];
  return def.map((s) => ({ key: s.key, label: s.label, color: s.color }));
}

function mergeStageCountsIntoDisplayOrder(
  ordered: WorkflowBreakdownStage[],
  stageCounts: Record<string, number>
): WorkflowBreakdownStage[] {
  const seen = new Set(ordered.map((s) => s.key));
  const extras = Object.keys(stageCounts)
    .filter((k) => !seen.has(k))
    .sort();
  const extraStages: WorkflowBreakdownStage[] = extras.map((k) => ({
    key: k,
    label: k.replace(/_/g, " "),
    color: "#64748b",
  }));
  return [...ordered, ...extraStages];
}

async function attachWorkflowBreakdown(
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return rows;

  const pkgIds = rows.map((r) => String(r.id));

  const wfRows = (await query(
    `SELECT w.id, w."packageId"::text AS "packageId", w.name, w."ownerAgent", w.spec,
            b.stages AS board_stages
     FROM "_workflow" w
     LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
     WHERE w."packageId" = ANY($1::uuid[]) AND w."deletedAt" IS NULL`,
    [pkgIds]
  )) as Record<string, unknown>[];

  const wfIds = wfRows.map((w) => String(w.id));
  type CountRow = { workflowId: string; stage: string; count: string };
  let countRows: CountRow[] = [];
  if (wfIds.length > 0) {
    countRows = (await query(
      `SELECT "workflowId"::text AS "workflowId",
              UPPER(TRIM(wi.stage::text)) AS stage,
              COUNT(*)::text AS count
       FROM "_workflow_item" wi
       WHERE wi."workflowId" = ANY($1::uuid[]) AND wi."deletedAt" IS NULL
       GROUP BY wi."workflowId", UPPER(TRIM(wi.stage::text))`,
      [wfIds]
    )) as CountRow[];
  }

  const countsByWf: Record<string, Record<string, number>> = {};
  for (const c of countRows) {
    if (!countsByWf[c.workflowId]) countsByWf[c.workflowId] = {};
    const sk = String(c.stage).trim().toUpperCase();
    countsByWf[c.workflowId][sk] = parseInt(c.count, 10);
  }

  const workflowsByPackage = new Map<string, WorkflowBreakdownRow[]>();
  for (const wf of wfRows) {
    const pkgId = String(wf.packageId);
    const pkgRow = rows.find((r) => String(r.id) === pkgId);
    const templateId = String(pkgRow?.templateId || "");
    const spec = parseWorkflowSpec(wf.spec);
    const registryId = resolveWorkflowRegistryId(spec.workflowType) || "";
    const boardStages = parseBoardStagesJson(wf.board_stages);
    const baseStages = stagesForWorkflow(boardStages, registryId || spec.workflowType || "");
    const stageCounts = countsByWf[String(wf.id)] || {};
    const totalItems = Object.values(stageCounts).reduce((a, b) => a + b, 0);
    const merged = mergeStageCountsIntoDisplayOrder(baseStages, stageCounts);
    const stages = enrichStagesHuman(merged, registryId);
    const delMeta = deliverableMetaForWorkflow(pkgRow?.spec, templateId, registryId);
    const targetFromWf = spec.targetCount ?? 0;
    const targetFromTemplate = delMeta.templateTarget ?? 0;
    const targetCount =
      targetFromWf > 0 ? targetFromWf : targetFromTemplate > 0 ? targetFromTemplate : 0;

    const entry: WorkflowBreakdownRow = {
      id: String(wf.id),
      name: String(wf.name || ""),
      ownerAgent: String(wf.ownerAgent || ""),
      workflowType: registryId || spec.workflowType || "",
      targetCount,
      volumeLabel: delMeta.volumeLabel || null,
      totalItems,
      stageCounts,
      stages,
    };
    const list = workflowsByPackage.get(pkgId) || [];
    list.push(entry);
    workflowsByPackage.set(pkgId, list);
  }

  return rows.map((r) => ({
    ...r,
    workflows: workflowsByPackage.get(String(r.id)) || [],
  }));
}

function isMissingPackageNumberColumn(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /packageNumber/i.test(msg) && (/does not exist/i.test(msg) || /column/i.test(msg));
}

export async function GET(req: NextRequest) {
  try {
    const stage = req.nextUrl.searchParams.get("stage");
    const customerId = req.nextUrl.searchParams.get("customerId");
    const operational =
      req.nextUrl.searchParams.get("operational") === "true" ||
      req.nextUrl.searchParams.get("operational") === "1";
    const includeStats =
      req.nextUrl.searchParams.get("includeStats") === "true" ||
      req.nextUrl.searchParams.get("includeStats") === "1";
    const includeWorkflowBreakdown =
      req.nextUrl.searchParams.get("includeWorkflowBreakdown") === "true" ||
      req.nextUrl.searchParams.get("includeWorkflowBreakdown") === "1";

    const params: unknown[] = [];
    const conditions: string[] = ['p."deletedAt" IS NULL'];

    if (operational) {
      conditions.push(`UPPER(p.stage::text) IN ('ACTIVE', 'PAUSED', 'COMPLETED')`);
    } else if (stage) {
      params.push(stage.toUpperCase());
      conditions.push(`p.stage = $${params.length}`);
    }
    if (customerId) {
      params.push(customerId);
      conditions.push(`p."customerId" = $${params.length}`);
    }

    const itemCountSelect = includeStats
      ? `, (SELECT COUNT(*)::int FROM "_workflow_item" wi
          INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
          WHERE w."packageId" = p.id AND wi."deletedAt" IS NULL) AS "itemCount"`
      : "";

    const buildSql = (includePackageNumber: boolean) =>
      `SELECT p.id, p.name, p."templateId", p.stage, p.spec,
              ${includePackageNumber ? 'p."packageNumber",' : ""}
              p."customerId", p."customerType", p."createdBy", p."createdAt",
              (SELECT COUNT(*)::int FROM "_workflow" w
               WHERE w."packageId" = p.id AND w."deletedAt" IS NULL) AS "workflowCount"
              ${itemCountSelect}
       FROM "_package" p
       WHERE ${conditions.join(" AND ")}
       ORDER BY p."updatedAt" DESC NULLS LAST, p."createdAt" DESC
       LIMIT 100`;

    let rows: Record<string, unknown>[];
    try {
      rows = (await query(buildSql(true), params)) as Record<string, unknown>[];
    } catch (error) {
      if (isMissingPackageNumberColumn(error)) {
        console.warn("[packages] GET: packageNumber column missing — retrying without it (run migrate-package-number.sql)");
        rows = (await query(buildSql(false), params)) as Record<string, unknown>[];
        rows = rows.map((r) => ({ ...r, packageNumber: null }));
      } else {
        throw error;
      }
    }

    if (includeWorkflowBreakdown) {
      rows = await attachWorkflowBreakdown(rows);
    }

    return NextResponse.json({ packages: rows });
  } catch (error) {
    console.error("[packages] GET error:", error);
    return NextResponse.json(
      { error: "Failed to list packages" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { templateId, name: nameInput, customerId, customerType, spec } = body;

    if (!templateId) {
      return NextResponse.json(
        { error: "templateId is required" },
        { status: 400 }
      );
    }

    const { PACKAGE_TEMPLATES } = await import("@/lib/package-types");
    const template = PACKAGE_TEMPLATES[templateId];
    if (!template) {
      return NextResponse.json(
        { error: `Unknown template: ${templateId}` },
        { status: 400 }
      );
    }

    const name =
      typeof nameInput === "string" && nameInput.trim() !== ""
        ? nameInput.trim()
        : template.label;

    const baseSpec =
      spec && typeof spec === "object" && !Array.isArray(spec)
        ? { ...spec }
        : { deliverables: template.deliverables };

    let pkgSpec: Record<string, unknown> = baseSpec;
    if (templateId === "vibe-coding-outreach") {
      const briefRaw = pkgSpec.brief;
      const briefStr = typeof briefRaw === "string" ? briefRaw.trim() : "";
      if (!briefStr) {
        const { TIM_WARM_OUTREACH_PACKAGE_BRIEF } = await import(
          "@/lib/package-spec-briefs/tim-warm-outreach-package-brief"
        );
        pkgSpec = { ...pkgSpec, brief: TIM_WARM_OUTREACH_PACKAGE_BRIEF };
      }
      const existingCadence =
        pkgSpec.warmOutreachDiscovery && typeof pkgSpec.warmOutreachDiscovery === "object"
          ? (pkgSpec.warmOutreachDiscovery as Record<string, unknown>)
          : {};
      pkgSpec = {
        ...pkgSpec,
        warmOutreachDiscovery: {
          ...DEFAULT_WARM_OUTREACH_DISCOVERY,
          pacedDaily: true,
          ...existingCadence,
        },
      };
    }

    let rows: Record<string, unknown>[];
    try {
      rows = (await query(
        `INSERT INTO "_package" ("templateId", name, "customerId", "customerType", spec, stage, "createdBy", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::jsonb, 'DRAFT', 'penny', NOW(), NOW()) RETURNING id, "packageNumber"`,
        [templateId, name, customerId || null, customerType || "person", JSON.stringify(pkgSpec)]
      )) as Record<string, unknown>[];
    } catch (error) {
      if (isMissingPackageNumberColumn(error)) {
        rows = (await query(
          `INSERT INTO "_package" ("templateId", name, "customerId", "customerType", spec, stage, "createdBy", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5::jsonb, 'DRAFT', 'penny', NOW(), NOW()) RETURNING id`,
          [templateId, name, customerId || null, customerType || "person", JSON.stringify(pkgSpec)]
        )) as Record<string, unknown>[];
      } else {
        throw error;
      }
    }

    const row0 = rows[0] as Record<string, unknown>;
    return NextResponse.json({ id: row0.id, packageNumber: row0.packageNumber ?? null });
  } catch (error) {
    console.error("[packages] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create package" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, stage, spec, name } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const sets: string[] = ['"updatedAt" = NOW()'];
    const params: unknown[] = [];

    if (stage) {
      const validStages = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ACTIVE", "PAUSED", "COMPLETED"];
      if (!validStages.includes(stage.toUpperCase())) {
        return NextResponse.json(
          { error: `stage must be one of: ${validStages.join(", ")}` },
          { status: 400 }
        );
      }
      params.push(stage.toUpperCase());
      sets.push(`stage = $${params.length}`);
    }
    if (spec) {
      // Merge spec fields into existing spec (preserves deliverables when updating brief, etc.)
      params.push(JSON.stringify(spec));
      sets.push(`spec = COALESCE(spec, '{}'::jsonb) || $${params.length}::jsonb`);
    }
    if (name) {
      params.push(name);
      sets.push(`name = $${params.length}`);
    }

    params.push(id);
    await query(
      `UPDATE "_package" SET ${sets.join(", ")} WHERE id = $${params.length} AND "deletedAt" IS NULL`,
      params
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[packages] PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update package" },
      { status: 500 }
    );
  }
}
