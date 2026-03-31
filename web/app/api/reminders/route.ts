import { NextResponse, type NextRequest } from "next/server";
import {
  listReminders,
  updateReminder,
  deleteReminder,
  softDeleteInactiveReminders,
  countDueReminders,
} from "@/lib/reminders";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("dueSummary") === "1") {
      const agentId = searchParams.get("agentId") || "suzi";
      const dueCount = await countDueReminders(agentId);
      return NextResponse.json({ dueCount });
    }
    const agentId = searchParams.get("agentId") || "suzi";
    const category = searchParams.get("category") || undefined;
    const search = searchParams.get("search") || undefined;
    const upcoming = searchParams.get("upcoming") === "true";

    const reminders = await listReminders(agentId, {
      category,
      search,
      upcoming,
      includeInactive: searchParams.get("includeInactive") === "true",
    });

    return NextResponse.json({ reminders });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : "Failed to fetch reminders";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    await updateReminder(id, updates);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : "Failed to update reminder";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    await deleteReminder(body.id);
    notifyDashboardSyncChange();
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : "Failed to delete reminder";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Bulk: `{ "action": "softDeleteInactive", "agentId"?: "suzi" }` */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body?.action !== "softDeleteInactive") {
      return NextResponse.json({ error: "unsupported action" }, { status: 400 });
    }
    const agentId =
      typeof body.agentId === "string" && body.agentId.trim()
        ? body.agentId.trim()
        : "suzi";
    const removed = await softDeleteInactiveReminders(agentId);
    notifyDashboardSyncChange();
    return NextResponse.json({ success: true, removed });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : "Failed to run bulk reminder action";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
