import { query, transaction, crmUsesJsonDevStore } from "@/lib/db";
import { PACKAGE_DELETE_BLOCKED_TEMPLATE_IDS } from "@/lib/package-types";
import { getPackageByIdDevStore, softDeletePackageCascadeDevStore } from "@/lib/dev-store";

export type SoftDeletePackageResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Normalize DB/UI stage strings (spaces vs underscores, casing). */
function normalizeStage(stage: string): string {
  return String(stage ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function validateDeletable(stage: string, templateId: string): SoftDeletePackageResult {
  const s = normalizeStage(stage);
  if (s !== "DRAFT" && s !== "PENDING_APPROVAL") {
    return {
      ok: false,
      error: "Only Draft or Testing packages can be deleted. Pause or complete active packages instead.",
      status: 400,
    };
  }
  const tid = String(templateId ?? "").trim();
  if (PACKAGE_DELETE_BLOCKED_TEMPLATE_IDS.has(tid)) {
    return { ok: false, error: "This system package cannot be deleted.", status: 400 };
  }
  return { ok: true };
}

/**
 * Soft-delete a package and its workflows (Draft / Testing only). Same CRM DB / dev-store as `query()`.
 */
export async function softDeletePackage(packageId: string): Promise<SoftDeletePackageResult> {
  const id = String(packageId ?? "").trim();
  if (!id) {
    return { ok: false, error: "package id is required", status: 400 };
  }

  if (crmUsesJsonDevStore()) {
    const row = getPackageByIdDevStore(id);
    if (!row) {
      return { ok: false, error: "Package not found", status: 404 };
    }
    const v = validateDeletable(String(row.stage ?? ""), String(row.templateId ?? ""));
    if (!v.ok) return v;
    const did = await softDeletePackageCascadeDevStore(id);
    return did ? { ok: true } : { ok: false, error: "Package not found", status: 404 };
  }

  if (!UUID_RE.test(id)) {
    return { ok: false, error: "Invalid package id", status: 400 };
  }

  const rows = (await query(
    `SELECT stage, "templateId" FROM "_package" WHERE id = $1::uuid AND "deletedAt" IS NULL`,
    [id]
  )) as { stage: string; templateId: string }[];

  if (rows.length === 0) {
    return { ok: false, error: "Package not found", status: 404 };
  }

  const v = validateDeletable(rows[0].stage, rows[0].templateId);
  if (!v.ok) return v;

  try {
    await transaction(async (run) => {
      await run(
        `UPDATE "_artifact" SET "deletedAt" = NOW(), "updatedAt" = NOW()
         WHERE "deletedAt" IS NULL AND "workflowItemId" IN (
           SELECT wi.id FROM "_workflow_item" wi
           INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
           WHERE w."packageId" = $1::uuid AND wi."deletedAt" IS NULL
         )`,
        [id]
      );

      await run(
        `UPDATE "_workflow_item" SET "deletedAt" = NOW(), "humanTaskOpen" = false, "updatedAt" = NOW()
         WHERE "deletedAt" IS NULL AND "workflowId" IN (
           SELECT w2.id FROM "_workflow" w2 WHERE w2."packageId" = $1::uuid AND w2."deletedAt" IS NULL
         )`,
        [id]
      );

      const boardRes = await run(
        `SELECT DISTINCT w."boardId"::text AS "boardId" FROM "_workflow" w
         WHERE w."packageId" = $1::uuid AND w."deletedAt" IS NULL AND w."boardId" IS NOT NULL`,
        [id]
      );
      const boardRows = boardRes.rows as { boardId: string }[];
      const boardIds = boardRows.map((r) => r.boardId).filter(Boolean);
      if (boardIds.length > 0) {
        await run(
          `UPDATE "_board" SET "deletedAt" = NOW(), "updatedAt" = NOW()
           WHERE "deletedAt" IS NULL AND id = ANY($1::uuid[])`,
          [boardIds]
        );
      }

      await run(
        `UPDATE "_workflow" SET "deletedAt" = NOW(), "updatedAt" = NOW()
         WHERE "packageId" = $1::uuid AND "deletedAt" IS NULL`,
        [id]
      );

      const pkgUpd = (await run(
        `UPDATE "_package" SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1::uuid AND "deletedAt" IS NULL`,
        [id]
      )) as { rowCount?: number };
      if ((pkgUpd.rowCount ?? 0) === 0) {
        throw new Error("PACKAGE_ALREADY_DELETED");
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "PACKAGE_ALREADY_DELETED") {
      return { ok: false, error: "Package not found or already deleted", status: 404 };
    }
    console.error("[softDeletePackage]", e);
    if (/invalid input syntax for type uuid/i.test(msg)) {
      return { ok: false, error: "Invalid package id", status: 400 };
    }
    return { ok: false, error: "Failed to delete package (database error)", status: 500 };
  }

  return { ok: true };
}
