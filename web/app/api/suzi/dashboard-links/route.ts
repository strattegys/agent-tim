import { NextResponse } from "next/server";
import { getSuziPersonalDashboardConfig } from "@/lib/suzi-personal-dashboard-config";

export async function GET() {
  try {
    const c = getSuziPersonalDashboardConfig();
    return NextResponse.json({
      ymca: c.ymca,
      eventsSectionSubtitle: c.eventsSectionSubtitle,
      eventLinks: c.eventLinks,
      importantLinks: c.importantLinks,
      personalLinks: c.personalLinks,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load dashboard links";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
