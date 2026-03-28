import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { fetchDashboardSyncPayload } from "@/lib/dashboard-sync-server";
import { subscribeDashboardSync } from "@/lib/dashboard-sync-hub";

export const runtime = "nodejs";

/**
 * Long-interval safety poll: catches external writers (nanobot notifications file,
 * other instances, webhooks on another worker). Default 90s, clamp 30s–10m.
 */
const SAFETY_TICK_MS = Math.max(
  30_000,
  Math.min(
    600_000,
    parseInt(process.env.DASHBOARD_STREAM_SAFETY_TICK_MS || "90000", 10) || 90_000
  )
);

/** Coalesce bursty notifies (many tool calls in one tick). */
const NOTIFY_DEBOUNCE_MS = 150;

/** Comment line keep-alive for proxies (ms). */
const PING_MS = 25_000;

/**
 * Server-Sent Events: pushes dashboard badge + notification updates when data changes.
 * Primary driver: notifyDashboardSyncChange() after CRM mutations (same process).
 * Same payload shape as GET /api/dashboard-sync. Authenticated via session cookie.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const origin = req.nextUrl.origin;
  const cookie = req.headers.get("cookie") ?? "";

  const encoder = new TextEncoder();
  let lastSerialized = "";
  let safetyTimer: ReturnType<typeof setInterval> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let hubUnsub: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const pushIfChanged = async () => {
        try {
          const payload = await fetchDashboardSyncPayload(origin, cookie);
          const json = JSON.stringify(payload);
          if (json !== lastSerialized) {
            lastSerialized = json;
            controller.enqueue(encoder.encode(`data: ${json}\n\n`));
          }
        } catch {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ ok: false })}\n\n`)
          );
        }
      };

      await pushIfChanged();

      const schedulePush = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          void pushIfChanged();
        }, NOTIFY_DEBOUNCE_MS);
      };

      hubUnsub = subscribeDashboardSync(schedulePush);

      safetyTimer = setInterval(() => {
        void pushIfChanged();
      }, SAFETY_TICK_MS);

      pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          /* stream may be closed */
        }
      }, PING_MS);
    },
    cancel() {
      hubUnsub?.();
      if (debounceTimer) clearTimeout(debounceTimer);
      if (safetyTimer) clearInterval(safetyTimer);
      if (pingTimer) clearInterval(pingTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
