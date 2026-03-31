import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { backfillWarmRepliedInboundFromWorkflowItemId } from "@/lib/warm-replied-inbound-backfill";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const workflowItemId =
    typeof body === "object" &&
    body !== null &&
    typeof (body as { workflowItemId?: unknown }).workflowItemId === "string"
      ? (body as { workflowItemId: string }).workflowItemId.trim()
      : "";

  if (!workflowItemId) {
    return NextResponse.json({ error: "workflowItemId is required" }, { status: 400 });
  }

  const result = await backfillWarmRepliedInboundFromWorkflowItemId(workflowItemId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json({
    ok: true,
    inboundPreview: result.inboundPreview,
    firstName: result.firstName,
    lastName: result.lastName,
    draftUpdated: result.draftUpdated,
  });
}
