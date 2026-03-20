import { NextResponse } from "next/server";
import { crmFetch } from "@/lib/crm";

export async function GET() {
  try {
    const data = await crmFetch("/rest/campaigns?limit=50&orderBy=name=AscNullsLast");
    const campaigns = (data.data?.campaigns ?? data.campaigns ?? data.data ?? []).map(
      (c: Record<string, unknown>) => ({
        id: c.id,
        name: c.name,
        stage: c.stage,
      })
    );
    return NextResponse.json({ campaigns });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to fetch campaigns";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
