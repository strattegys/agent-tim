import { NextResponse } from "next/server";
import { initCronJobs } from "@/lib/cron";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.npm_lifecycle_event !== "build") {
    initCronJobs();
  }
  return NextResponse.json({ ok: true });
}
