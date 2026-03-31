import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { observabilityApiAllowed } from "@/lib/observability-gate";
import {
  getObservabilityToggleRows,
  setObservabilityToggle,
  type ObservabilityToggleKey,
} from "@/lib/observability-runtime";

export const runtime = "nodejs";

function envTruthy(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * GET — current toggles (effective = env ∪ optional in-process override) + read-only dev flags.
 * POST — set or clear override for a toggle key (body: { key, value: boolean | null }).
 */
export async function GET() {
  if (!observabilityApiAllowed()) {
    return NextResponse.json(
      { error: "Not available (use development or DEV_UNIPILE_INBOUND_REPLAY=1)" },
      { status: 404 }
    );
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const toggles = getObservabilityToggleRows();
  const readOnly = [
    {
      key: "DEV_UNIPILE_INBOUND_REPLAY",
      label: "Unipile inbound replay API",
      description: "Allows POST /api/dev/replay-unipile-inbound when not in NODE_ENV=development.",
      on: envTruthy("DEV_UNIPILE_INBOUND_REPLAY"),
    },
    {
      key: "UNIPILE_REPLAY_ALLOW_REMOTE_CRM",
      label: "Replay allow remote CRM",
      description: "Dangerous: replay may write to non-local CRM. Set only for intentional staging.",
      on: envTruthy("UNIPILE_REPLAY_ALLOW_REMOTE_CRM"),
    },
  ];

  return NextResponse.json({ toggles, readOnly });
}

export async function POST(req: NextRequest) {
  if (!observabilityApiAllowed()) {
    return NextResponse.json(
      { error: "Not available (use development or DEV_UNIPILE_INBOUND_REPLAY=1)" },
      { status: 404 }
    );
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const key = body.key as string | undefined;
  const allowed: ObservabilityToggleKey[] = ["GROQ_CHAT_DEBUG", "TIM_CHAT_CONTEXT_DEBUG"];
  if (!key || !allowed.includes(key as ObservabilityToggleKey)) {
    return NextResponse.json({ error: "Unknown or missing key" }, { status: 400 });
  }

  const raw = body.value;
  let value: boolean | null;
  if (raw === null || raw === undefined) {
    value = null;
  } else if (typeof raw === "boolean") {
    value = raw;
  } else {
    return NextResponse.json({ error: "value must be boolean or null" }, { status: 400 });
  }

  setObservabilityToggle(key as ObservabilityToggleKey, value);

  return NextResponse.json({ ok: true, toggles: getObservabilityToggleRows() });
}
