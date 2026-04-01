import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import type { WorkflowItemType } from "@/lib/board-types";
import { syncHumanTaskOpenForItem } from "@/lib/workflow-item-human-task";
import { WARM_DISCOVERY_SOURCE_TYPE } from "@/lib/warm-discovery-item";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";
import { pushWorkflowObservabilityEvent } from "@/lib/workflow-observability-buffer";
import { attachPersonToWorkflow } from "@/lib/attach-person-to-workflow";
import { promoteReplyToCloseFromReplied } from "@/lib/reply-to-close-promote";

interface PersonRow {
  [key: string]: unknown;
  id: string;
  workflowId: string;
  stage: string;
  sourceType: string;
  sourceId: string;
  position: number;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  linkedinUrl: string | null;
  city: string | null;
  companyName: string | null;
}

interface ContentRow {
  [key: string]: unknown;
  id: string;
  workflowId: string;
  stage: string;
  sourceType: string;
  sourceId: string;
  position: number;
  title: string | null;
  description: string | null;
  url: string | null;
  contentType: string | null;
  publishDate: string | null;
}

export async function GET(request: NextRequest) {
  const workflowId = request.nextUrl.searchParams.get("workflowId");
  if (!workflowId) {
    return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
  }

  try {
    // Determine workflow's itemType
    const wfRows = await query<{ itemType: string }>(
      `SELECT "itemType" FROM "_workflow" WHERE id = $1 AND "deletedAt" IS NULL`,
      [workflowId]
    );
    if (wfRows.length === 0) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }
    const itemType = wfRows[0].itemType as WorkflowItemType;

    if (itemType === "person") {
      const rows = await query<PersonRow>(
        `SELECT
          wi.id, wi."workflowId", wi.stage, wi."sourceType", wi."sourceId", wi.position,
          wi."humanTaskOpen" AS "humanTaskOpen",
          p."nameFirstName" AS "firstName",
          p."nameLastName" AS "lastName",
          p."jobTitle" AS "jobTitle",
          p."emailsPrimaryEmail" AS email,
          p."linkedinLinkPrimaryLinkUrl" AS "linkedinUrl",
          p.city,
          COALESCE(c.name, '') AS "companyName"
        FROM "_workflow_item" wi
        LEFT JOIN person p ON p.id = wi."sourceId" AND p."deletedAt" IS NULL
        LEFT JOIN company c ON c.id = p."companyId" AND c."deletedAt" IS NULL
        WHERE wi."workflowId" = $1
          AND wi."deletedAt" IS NULL
        ORDER BY wi.position ASC, p."nameFirstName" ASC NULLS LAST`,
        [workflowId]
      );

      const items = rows.map((r) => ({
        id: r.id,
        workflowId: r.workflowId,
        stage: r.stage || "TARGET",
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        position: r.position || 0,
        humanTaskOpen: Boolean((r as { humanTaskOpen?: boolean }).humanTaskOpen),
        title:
          r.sourceType === WARM_DISCOVERY_SOURCE_TYPE
            ? "Next contact"
            : [r.firstName, r.lastName].filter(Boolean).join(" ") || "Unknown",
        subtitle: r.sourceType === WARM_DISCOVERY_SOURCE_TYPE ? "" : r.jobTitle || "",
        extra: r.companyName || "",
        linkedinUrl: r.linkedinUrl || "",
        email: r.email || "",
      }));

      return NextResponse.json({ items });
    }

    if (itemType === "content") {
      const rows = await query<ContentRow>(
        `SELECT
          wi.id, wi."workflowId", wi.stage, wi."sourceType", wi."sourceId", wi.position,
          wi."humanTaskOpen" AS "humanTaskOpen",
          ci.title, ci.description, ci.url, ci."contentType", ci."publishDate"
        FROM "_workflow_item" wi
        LEFT JOIN "_content_item" ci ON ci.id = wi."sourceId" AND ci."deletedAt" IS NULL
        WHERE wi."workflowId" = $1
          AND wi."deletedAt" IS NULL
        ORDER BY wi.position ASC, ci.title ASC NULLS LAST`,
        [workflowId]
      );

      const items = rows.map((r) => ({
        id: r.id,
        workflowId: r.workflowId,
        stage: r.stage,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        position: r.position || 0,
        humanTaskOpen: Boolean((r as { humanTaskOpen?: boolean }).humanTaskOpen),
        title: r.title || "Untitled",
        subtitle: r.contentType || "article",
        extra: r.url || "",
      }));

      return NextResponse.json({ items });
    }

    return NextResponse.json({ items: [] });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to fetch workflow items";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workflowId, sourceType, sourceId, stage } = body;
    const closeIntakeItemIdRaw = body.closeIntakeItemId;
    const closeIntakeItemId =
      typeof closeIntakeItemIdRaw === "string" && closeIntakeItemIdRaw.trim().length > 0
        ? closeIntakeItemIdRaw.trim()
        : null;

    if (!workflowId || !sourceType || !stage) {
      return NextResponse.json(
        { error: "workflowId, sourceType, and stage are required" },
        { status: 400 }
      );
    }

    if (closeIntakeItemId && sourceType !== "person") {
      return NextResponse.json(
        { error: "closeIntakeItemId is only valid when sourceType is person" },
        { status: 400 }
      );
    }

    if (closeIntakeItemId && !sourceId) {
      return NextResponse.json(
        { error: "sourceId is required when closeIntakeItemId is set" },
        { status: 400 }
      );
    }

    // If sourceType is 'content' and no sourceId, create the content item inline
    if (sourceType === "content" && !sourceId) {
      const { title, description, url, contentType } = body;
      if (!title) {
        return NextResponse.json({ error: "title is required for content items" }, { status: 400 });
      }
      const ciRows = await query<{ id: string }>(
        `INSERT INTO "_content_item" (title, description, url, "contentType", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING id`,
        [title, description || null, url || null, contentType || "article"]
      );
      const contentId = ciRows[0].id;

      const wiRows = await query<{ id: string }>(
        `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING id`,
        [workflowId, stage, "content", contentId]
      );
      const newWi = wiRows[0].id;
      await syncHumanTaskOpenForItem(newWi);
      pushWorkflowObservabilityEvent("workflow_item_created", {
        itemId: newWi,
        workflowId,
        stage,
        sourceType: "content",
        sourceId: contentId,
      });
      return NextResponse.json({ id: newWi, sourceId: contentId });
    }

    // Otherwise link an existing source record
    if (!sourceId) {
      return NextResponse.json({ error: "sourceId is required" }, { status: 400 });
    }

    const attached = await attachPersonToWorkflow({
      workflowId,
      stage,
      sourceType,
      sourceId: String(sourceId),
      closeIntakeItemId,
    });
    if (!attached.ok) {
      return NextResponse.json({ error: attached.error }, { status: 400 });
    }
    pushWorkflowObservabilityEvent("workflow_item_created", {
      itemId: attached.id,
      workflowId,
      stage,
      sourceType,
      sourceId: String(sourceId),
      closedIntakeItemId: attached.closedIntakeItemId ?? undefined,
    });
    await promoteReplyToCloseFromReplied(attached.id);

    return NextResponse.json({
      id: attached.id,
      closedIntakeItemId: attached.closedIntakeItemId,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to create workflow item";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { id, stage, position } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const sets: string[] = ['"updatedAt" = NOW()'];
    const params: unknown[] = [];
    let idx = 1;

    if (stage !== undefined) {
      sets.push(`stage = $${idx++}`);
      params.push(stage);
    }
    if (position !== undefined) {
      sets.push(`position = $${idx++}`);
      params.push(position);
    }

    if (sets.length === 1) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    params.push(id);
    await query(
      `UPDATE "_workflow_item" SET ${sets.join(", ")} WHERE id = $${idx} AND "deletedAt" IS NULL`,
      params
    );
    if (stage !== undefined) {
      await syncHumanTaskOpenForItem(String(id));
      await promoteReplyToCloseFromReplied(String(id));
    }
    pushWorkflowObservabilityEvent("workflow_item_patch", {
      itemId: String(id),
      stage: stage !== undefined ? String(stage) : undefined,
      position: position !== undefined ? position : undefined,
    });
    notifyDashboardSyncChange();
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to update workflow item";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    await query(
      `UPDATE "_workflow_item" SET "deletedAt" = NOW(), "humanTaskOpen" = false WHERE id = $1 AND "deletedAt" IS NULL`,
      [id]
    );
    pushWorkflowObservabilityEvent("workflow_item_deleted", { itemId: String(id) });
    notifyDashboardSyncChange();
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to delete workflow item";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
