import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncAnthropicCostReportToUsageEvents } from "@/lib/anthropic-admin-sync";

/** Session or x-internal-key (INTERNAL_API_KEY). */
export async function POST(request: Request) {
  const internalKey = process.env.INTERNAL_API_KEY?.trim();
  const keyOk =
    internalKey && request.headers.get("x-internal-key") === internalKey;
  const session = await auth();
  if (!keyOk && !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let days = 7;
  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body.days === "number" && Number.isFinite(body.days)) {
      days = body.days;
    }
  } catch {
    /* use default */
  }

  const result = await syncAnthropicCostReportToUsageEvents({ days });
  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json(result);
}
