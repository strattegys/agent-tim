import { NextResponse } from "next/server";
import { recordUsageEvent, type UsageEventInput } from "@/lib/usage-events";

/**
 * Internal: other apps (e.g. strattegys-site, rainbow) can POST metered events here
 * when COMMAND_CENTRAL_USAGE_INGEST_URL + INTERNAL_API_KEY are configured.
 */
export async function POST(request: Request) {
  const internalKey = process.env.INTERNAL_API_KEY?.trim();
  if (!internalKey || request.headers.get("x-internal-key") !== internalKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const events = (body as { events?: UsageEventInput[] }).events;
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json(
      { error: "Expected { events: UsageEventInput[] }" },
      { status: 400 }
    );
  }

  let accepted = 0;
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const row = ev as UsageEventInput;
    const app = typeof row.application === "string" ? row.application.trim() : "";
    if (
      typeof row.surface !== "string" ||
      typeof row.provider !== "string" ||
      !app
    ) {
      continue;
    }
    recordUsageEvent({ ...row, application: app });
    accepted += 1;
  }

  return NextResponse.json({ ok: true, accepted, total: events.length });
}
