import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { PACKAGE_TEMPLATES, type PackageDeliverable } from "@/lib/package-types";
import type { WorkflowTypeSpec } from "@/lib/workflow-types";
import {
  loadCustomWorkflowTypeMap,
  resolveWorkflowRegistryIdWithCustom,
  resolveWorkflowTypeFromMaps,
} from "@/lib/workflow-registry";
import {
  parseJsonObject,
  workflowTypeFromSpec,
} from "@/lib/workflow-spec";
import { stripUseFakeDataWhenPackageNotInTesting } from "@/lib/package-use-fake-data";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";
import { softDeletePackage } from "@/lib/package-delete";

/**
 * Packages API — CRUD for service packages.
 *
 * GET  ?stage=&customerId=&operational=true&includeStats=true&includeWorkflowBreakdown=true
 *      operational=true → stage IN (ACTIVE, PAUSED, COMPLETED) for Friday ops board
 *      includeStats=true → total workflow items across package workflows
 *      includeWorkflowBreakdown=true → per-workflow pipeline stages + item counts per stage (Friday cards)
 * POST {templateId, name, customerId?, customerType?, spec?} — Create package
 * PATCH {id, stage?, spec?, name?} — Update package
 * DELETE { id } — Soft-delete Draft/Testing package (not system templates)
 */

interface WorkflowBreakdownStage {
  key: string;
  label: string;
  color: string;
  /** Human step (planner-style icon) — from workflow type registry when known */
  requiresHuman?: boolean;
}

interface WorkflowBreakdownRow {
  id: string;
  name: string;
  ownerAgent: string;
  workflowType: string;
  /** Registry label for workflow type (built-in or custom) */
  workflowTypeLabel?: string;
  itemType?: "person" | "content";
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
  registryId: string,
  getSpec: (id: string) => WorkflowTypeSpec | undefined
): WorkflowBreakdownStage[] {
  const def = getSpec(registryId)?.defaultBoard?.stages;
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
  workflowType: string,
  getSpec: (id: string) => WorkflowTypeSpec | undefined
): WorkflowBreakdownStage[] {
  if (boardStages.length > 0) return boardStages;
  const def = getSpec(workflowType)?.defaultBoard?.stages;
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

  const customMap = await loadCustomWorkflowTypeMap();
  const getSpec = (id: string) => resolveWorkflowTypeFromMaps(id, customMap);

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
    const registryId =
      resolveWorkflowRegistryIdWithCustom(spec.workflowType, customMap) || "";
    const boardStages = parseBoardStagesJson(wf.board_stages);
    const baseStages = stagesForWorkflow(boardStages, registryId || spec.workflowType || "", getSpec);
    const stageCounts = countsByWf[String(wf.id)] || {};
    const totalItems = Object.values(stageCounts).reduce((a, b) => a + b, 0);
    const merged = mergeStageCountsIntoDisplayOrder(baseStages, stageCounts);
    const stages = enrichStagesHuman(merged, registryId, getSpec);
    const delMeta = deliverableMetaForWorkflow(pkgRow?.spec, templateId, registryId);
    const targetFromWf = spec.targetCount ?? 0;
    const targetFromTemplate = delMeta.templateTarget ?? 0;
    const targetCount =
      targetFromWf > 0 ? targetFromWf : targetFromTemplate > 0 ? targetFromTemplate : 0;

    const typeSpec = getSpec(registryId || spec.workflowType || "");
    const entry: WorkflowBreakdownRow = {
      id: String(wf.id),
      name: String(wf.name || ""),
      ownerAgent: String(wf.ownerAgent || ""),
      workflowType: registryId || spec.workflowType || "",
      workflowTypeLabel: typeSpec?.label,
      itemType: typeSpec?.itemType,
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

/** Titles that track the package / template default — safe to rewrite when the package is renamed. */
function genericContentTitlesForPackageRename(
  oldPackageName: string,
  templateId: string
): string[] {
  const out = new Set<string>();
  const on = oldPackageName.trim();
  if (on) {
    out.add(on);
    out.add(`${on} — Draft`);
  }
  const tmpl = PACKAGE_TEMPLATES[templateId];
  for (const d of tmpl?.deliverables ?? []) {
    out.add(`${d.label} — Draft`);
  }
  return [...out];
}

async function syncLinkedContentTitlesAfterPackageRename(
  packageId: string,
  newPackageName: string,
  oldPackageName: string,
  templateId: string
): Promise<void> {
  const oldTrim = oldPackageName.trim();
  const newTrim = newPackageName.trim();
  if (!newTrim || oldTrim === newTrim) return;

  const patterns = genericContentTitlesForPackageRename(oldPackageName, templateId);
  if (patterns.length === 0) return;

  const newTitle = `${newTrim} — Draft`;
  await query(
    `UPDATE "_content_item" AS ci
     SET title = $1, "updatedAt" = NOW()
     FROM "_workflow_item" AS wi
     INNER JOIN "_workflow" AS w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
     WHERE w."packageId" = $2::uuid
       AND wi."sourceType" = 'content'
       AND wi."deletedAt" IS NULL
       AND ci.id = wi."sourceId"
       AND ci."deletedAt" IS NULL
       AND ci.title = ANY($3::text[])`,
    [newTitle, packageId, patterns]
  );
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

    if (operational) {
      const { warmOperationalTimLinkedInSystemPackages } = await import(
        "@/lib/ensure-tim-linkedin-system-package-workflow"
      );
      await warmOperationalTimLinkedInSystemPackages();
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

    if (!templateId || String(templateId).trim() !== "custom") {
      return NextResponse.json(
        {
          error:
            'Use templateId "custom" only. Pass spec.deliverables (array, may be empty); add workflows via PATCH or planner, then activate.',
        },
        { status: 400 }
      );
    }

    const { PACKAGE_TEMPLATES } = await import("@/lib/package-types");
    const template = PACKAGE_TEMPLATES.custom;
    if (!template) {
      return NextResponse.json({ error: "Server misconfiguration: custom template missing" }, { status: 500 });
    }

    const name =
      typeof nameInput === "string" && nameInput.trim() !== ""
        ? nameInput.trim()
        : template.label;

    const bodySpec =
      spec && typeof spec === "object" && !Array.isArray(spec)
        ? { ...spec }
        : {};
    const rawDels = bodySpec.deliverables;
    const deliverables = Array.isArray(rawDels) ? rawDels : [];
    const pkgSpec: Record<string, unknown> = { ...bodySpec, deliverables };

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
    notifyDashboardSyncChange();
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

    let renameSync: { oldName: string; templateId: string; newName: string } | null = null;
    const nameTrimmed =
      typeof name === "string" ? (name.trim() === "" ? null : name.trim()) : undefined;
    if (name !== undefined && typeof name === "string" && nameTrimmed === null) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    if (nameTrimmed != null) {
      const prevRows = (await query(
        `SELECT name, "templateId" FROM "_package" WHERE id = $1 AND "deletedAt" IS NULL`,
        [id]
      )) as { name: string; templateId: string }[];
      if (prevRows.length > 0) {
        const oldName = String(prevRows[0].name ?? "");
        if (oldName.trim() !== nameTrimmed) {
          renameSync = {
            oldName,
            templateId: String(prevRows[0].templateId ?? ""),
            newName: nameTrimmed,
          };
        }
      }
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
    if (spec && typeof spec === "object" && !Array.isArray(spec)) {
      // Read–merge–write in app code so `deliverables` (and other keys) always persist reliably.
      // SQL `jsonb || jsonb` and the dev-store COALESCE merge shim both mishandle some shapes.
      const prevRows = (await query(
        `SELECT spec FROM "_package" WHERE id = $1 AND "deletedAt" IS NULL`,
        [id]
      )) as { spec: unknown }[];
      if (prevRows.length === 0) {
        return NextResponse.json({ error: "Package not found" }, { status: 404 });
      }
      const current = parseJsonObject(prevRows[0].spec) || {};
      const incoming = spec as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...current, ...incoming };
      params.push(JSON.stringify(merged));
      sets.push(`spec = $${params.length}::jsonb`);
    }
    if (nameTrimmed != null) {
      params.push(nameTrimmed);
      sets.push(`name = $${params.length}`);
    }

    params.push(id);
    await query(
      `UPDATE "_package" SET ${sets.join(", ")} WHERE id = $${params.length} AND "deletedAt" IS NULL`,
      params
    );

    if (renameSync) {
      await syncLinkedContentTitlesAfterPackageRename(
        id,
        renameSync.newName,
        renameSync.oldName,
        renameSync.templateId
      );
    }

    if (stage) {
      await stripUseFakeDataWhenPackageNotInTesting(id, stage.toUpperCase());
    }

    notifyDashboardSyncChange();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[packages] PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update package" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const result = await softDeletePackage(id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    notifyDashboardSyncChange();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[packages] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete package" },
      { status: 500 }
    );
  }
}
