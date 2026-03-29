import { NextResponse } from "next/server";
import { initCronJobs } from "@/lib/cron";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.npm_lifecycle_event !== "build") {
    try {
      initCronJobs();
    } catch (e) {
      console.error("[api/health] initCronJobs failed:", e);
    }
  }
  return NextResponse.json({ ok: true });
}
