import { NextResponse, type NextRequest } from "next/server";
import { insertPunchListItemAction, patchPunchListItemAction } from "@/lib/punch-list";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const agentId = (body.agentId as string) || "suzi";
    const itemId = body.itemId as string;
    const content = body.content as string;
    if (!itemId) {
      return NextResponse.json({ error: "itemId is required" }, { status: 400 });
    }
    if (!content?.trim()) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    const action = await insertPunchListItemAction(agentId, itemId, content);
    return NextResponse.json({ action });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to add action";
    const status = msg === "Item not found" ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const agentId = (body.agentId as string) || "suzi";
    const id = body.id as string;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const patch: { done?: boolean; content?: string } = {};
    if (typeof body.done === "boolean") patch.done = body.done;
    if (typeof body.content === "string") patch.content = body.content;

    const result = await patchPunchListItemAction(agentId, id, patch);
    if (!result) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, itemNumber: result.itemNumber });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to update action";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
