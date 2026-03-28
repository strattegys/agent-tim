import { NextResponse, type NextRequest } from "next/server";
import {
  listIntake,
  countIntake,
  addIntake,
  updateIntake,
  deleteIntake,
  type IntakeSource,
} from "@/lib/intake";

const SOURCES = new Set<IntakeSource>(["ui", "agent", "share", "email"]);

function parseSource(v: unknown): IntakeSource {
  const s = typeof v === "string" ? v : "";
  return SOURCES.has(s as IntakeSource) ? (s as IntakeSource) : "ui";
}

function parseNonNegInt(v: string | null, fallback: number): number {
  if (v == null || v === "") return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agent") || "suzi";
  const search = request.nextUrl.searchParams.get("search") || undefined;
  const limitRaw = request.nextUrl.searchParams.get("limit");
  const offset = parseNonNegInt(request.nextUrl.searchParams.get("offset"), 0);
  const limit =
    limitRaw != null && limitRaw !== ""
      ? Math.min(500, Math.max(1, parseNonNegInt(limitRaw, 200) || 200))
      : 200;

  try {
    const [items, total] = await Promise.all([
      listIntake(agentId, { search, limit, offset }),
      countIntake(agentId, { search }),
    ]);
    return NextResponse.json({ items, total });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch intake";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { command, agentId = "suzi", ...data } = body;

    if (command === "add") {
      if (!data.title || typeof data.title !== "string") {
        return NextResponse.json({ error: "Title is required" }, { status: 400 });
      }
      const item = await addIntake(agentId, {
        title: data.title.trim(),
        url: data.url != null ? String(data.url).trim() || null : undefined,
        body: data.body != null ? String(data.body) : undefined,
        source: parseSource(data.source),
        meta: data.meta && typeof data.meta === "object" ? data.meta : undefined,
      });
      return NextResponse.json({ item });
    }

    if (command === "update") {
      if (!data.id) {
        return NextResponse.json({ error: "Intake id is required" }, { status: 400 });
      }
      await updateIntake(data.id, {
        title: data.title !== undefined ? String(data.title) : undefined,
        url: data.url !== undefined ? (data.url ? String(data.url) : null) : undefined,
        body: data.body !== undefined ? (data.body != null ? String(data.body) : null) : undefined,
      });
      return NextResponse.json({ success: true });
    }

    if (command === "delete" || command === "archive") {
      if (!data.id) {
        return NextResponse.json({ error: "Intake id is required" }, { status: 400 });
      }
      await deleteIntake(data.id);
      return NextResponse.json({ success: true, archived: command === "archive" });
    }

    return NextResponse.json({ error: "Unknown command" }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
