import { NextResponse } from "next/server";
import { handleUnipileWebhook } from "../../../../lib/linkedin-webhook";
import { isLinkedInAutomationDisabled } from "../../../../lib/linkedin-automation-gate";
import {
  enqueueUnipileWebhookPayload,
  flushUnipileWebhookInboxAfterEnqueue,
} from "../../../../lib/unipile-webhook-inbox";

const WEBHOOK_SECRET = process.env.UNIPILE_WEBHOOK_SECRET || "";

export async function POST(req: Request) {
  // Validate auth header
  if (WEBHOOK_SECRET) {
    const authHeader = req.headers.get("unipile-auth") || "";
    if (authHeader !== WEBHOOK_SECRET) {
      console.warn("[webhook] Invalid Unipile-Auth header");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Parse body
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (isLinkedInAutomationDisabled()) {
    return NextResponse.json({
      received: true,
      automationDisabled: true,
      message:
        "LINKEDIN_AUTOMATION_DISABLED is set — webhooks are not queued or processed. Remove it and restart to resume.",
    });
  }

  // Persist first (when enabled + table exists) so a crash after 200 still leaves work in CRM DB.
  const inboxId = await enqueueUnipileWebhookPayload(payload).catch((err) => {
    console.error("[webhook] Inbox enqueue failed:", err);
    return null;
  });

  const response = NextResponse.json({
    received: true,
    queued: inboxId != null,
  });

  if (inboxId) {
    void flushUnipileWebhookInboxAfterEnqueue(inboxId, 28).catch((err) =>
      console.error("[webhook] Inbox flush error:", err)
    );
  } else {
    void handleUnipileWebhook(payload as Parameters<typeof handleUnipileWebhook>[0]).catch((err) =>
      console.error("[webhook] Processing error:", err)
    );
  }

  return response;
}

export async function GET() {
  return NextResponse.json({ status: "ok" });
}
