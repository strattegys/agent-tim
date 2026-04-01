import { NextRequest, NextResponse } from "next/server";
import { getWorkflowTypeRegistry } from "@/lib/workflow-registry";
import { runPackageSimulateDay } from "@/lib/package-simulation";

/**
 * POST /api/crm/packages/simulate
 *
 * Body: { packageId, mode: "day", replyRate?, replyToCloseConversionRate?, seed? }
 * Rates are fractions in [0, 1]. One compressed “day” per request (opener intake + optional RTC path).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const packageId = body.packageId as string | undefined;
    const mode = (body.mode as string | undefined) ?? "day";

    if (!packageId) {
      return NextResponse.json({ error: "packageId is required" }, { status: 400 });
    }

    if (mode !== "day") {
      return NextResponse.json({ error: `Unknown simulate mode: ${mode}` }, { status: 400 });
    }

    const replyRate =
      typeof body.replyRate === "number" && Number.isFinite(body.replyRate) ? body.replyRate : 0.25;
    const replyToCloseConversionRate =
      typeof body.replyToCloseConversionRate === "number" &&
      Number.isFinite(body.replyToCloseConversionRate)
        ? body.replyToCloseConversionRate
        : 0.1;
    const seed =
      typeof body.seed === "number" && Number.isFinite(body.seed)
        ? Math.floor(body.seed)
        : (Date.now() ^ (Math.floor(Math.random() * 0x7fffffff) << 13)) >>> 0;

    const wfReg = await getWorkflowTypeRegistry();
    const result = await runPackageSimulateDay(
      {
        packageId,
        replyRate,
        replyToCloseConversionRate,
        seed,
      },
      wfReg
    );

    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const client =
      msg.includes("not found") || msg.includes("not allowed")
        ? 400
        : msg.includes("missing")
          ? 400
          : 500;
    console.error("[packages/simulate]", e);
    return NextResponse.json({ error: msg }, { status: client });
  }
}
