import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

/**
 * Packages API — CRUD for service packages.
 *
 * GET  ?stage=&customerId= — List packages with workflow count
 * POST {templateId, name, customerId?, customerType?, spec?} — Create package
 * PATCH {id, stage?, spec?, name?} — Update package
 */

export async function GET(req: NextRequest) {
  try {
    const stage = req.nextUrl.searchParams.get("stage");
    const customerId = req.nextUrl.searchParams.get("customerId");

    const params: unknown[] = [];
    const conditions: string[] = ['p."deletedAt" IS NULL'];

    if (stage) {
      params.push(stage.toUpperCase());
      conditions.push(`p.stage = $${params.length}`);
    }
    if (customerId) {
      params.push(customerId);
      conditions.push(`p."customerId" = $${params.length}`);
    }

    const rows = await query(
      `SELECT p.id, p.name, p."templateId", p.stage, p.spec,
              p."customerId", p."customerType", p."createdBy", p."createdAt",
              (SELECT COUNT(*)::int FROM "_workflow" w
               WHERE w."packageId" = p.id AND w."deletedAt" IS NULL) AS "workflowCount"
       FROM "_package" p
       WHERE ${conditions.join(" AND ")}
       ORDER BY p."createdAt" DESC
       LIMIT 100`,
      params
    );

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

    const pkgSpec = spec || { deliverables: template.deliverables };

    const rows = await query(
      `INSERT INTO "_package" ("templateId", name, "customerId", "customerType", spec, stage, "createdBy", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5::jsonb, 'DRAFT', 'penny', NOW(), NOW()) RETURNING id`,
      [templateId, name, customerId || null, customerType || "person", JSON.stringify(pkgSpec)]
    );

    return NextResponse.json({ id: (rows[0] as Record<string, unknown>).id });
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
      const validStages = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ACTIVE", "COMPLETED"];
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
