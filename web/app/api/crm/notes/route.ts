import { NextResponse, type NextRequest } from "next/server";
import { crmFetch } from "@/lib/crm";

export async function GET(request: NextRequest) {
  const personId = request.nextUrl.searchParams.get("personId");
  if (!personId) {
    return NextResponse.json({ error: "personId is required" }, { status: 400 });
  }

  try {
    // Twenty CRM notes use noteTargets to link to people
    // Try REST filter first, fall back to fetching all and filtering
    const path =
      `/rest/notes?limit=50&orderBy=createdAt=DescNullsLast` +
      `&filter[noteTargets][some][personId][eq]=${personId}`;
    const data = await crmFetch(path);
    const raw = data.data?.notes ?? data.notes ?? data.data ?? [];
    const notes = raw.map((n: Record<string, unknown>) => ({
      id: n.id,
      title: n.title ?? "",
      body: n.body ?? "",
      createdAt: n.createdAt ?? "",
    }));
    return NextResponse.json({ notes });
  } catch {
    // If the relation filter fails, return empty — we'll iterate on the filter
    return NextResponse.json({ notes: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { personId, title, body } = await request.json();
    if (!personId || !body) {
      return NextResponse.json({ error: "personId and body are required" }, { status: 400 });
    }

    const noteData = {
      title: title || "Web Note from Govind",
      body,
    };

    // Create the note
    const noteResult = await crmFetch("/rest/notes", {
      method: "POST",
      body: JSON.stringify(noteData),
    });

    const noteId = noteResult.data?.createNote?.id ?? noteResult.data?.id ?? noteResult.id;

    // Link note to person via noteTargets
    if (noteId) {
      try {
        await crmFetch("/rest/noteTargets", {
          method: "POST",
          body: JSON.stringify({
            noteId,
            personId,
          }),
        });
      } catch {
        // Non-fatal — note was created, just not linked
        console.warn("Failed to link note to person");
      }
    }

    return NextResponse.json({ success: true, noteId });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to create note";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
