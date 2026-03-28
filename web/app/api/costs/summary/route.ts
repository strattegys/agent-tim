import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildUsageSummary } from "@/lib/usage-events";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 30);

  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const fromIso = fromParam || defaultFrom.toISOString();
  const toIso = toParam || now.toISOString();

  try {
    const summary = await buildUsageSummary(fromIso, toIso);
    return NextResponse.json(summary);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bad request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
