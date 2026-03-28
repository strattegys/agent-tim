import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildUsageSummary } from "@/lib/usage-events";

/** Same-window totals and by-dimension rows must always match query params (no CDN stale merge). */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 30);

  const daysRaw = searchParams.get("days");
  let fromIso: string;
  let toIso: string;
  if (daysRaw !== null && /^\d{1,3}$/.test(daysRaw.trim())) {
    const d = Math.min(366, Math.max(1, parseInt(daysRaw.trim(), 10)));
    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - d);
    fromIso = from.toISOString();
    toIso = to.toISOString();
  } else {
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    fromIso = fromParam || defaultFrom.toISOString();
    toIso = toParam || now.toISOString();
  }

  try {
    const summary = await buildUsageSummary(fromIso, toIso);
    return NextResponse.json(summary, {
      headers: {
        "Cache-Control": "private, no-store, must-revalidate",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bad request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
