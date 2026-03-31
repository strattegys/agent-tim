/**
 * Display names for LinkedIn inbound: Unipile chat/message JSON varies by endpoint;
 * fall back to GET /users/{id} when the message only has a provider id (ACoA…).
 */
import {
  extractUnipileProfileCrmFields,
  fetchUnipileLinkedInProfile,
  isUnipileConfigured,
} from "@/lib/unipile-profile";

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Match attendee entry to counterparty provider id (ACoA… or slug). */
function nameFromAttendees(attendees: unknown, cpId: string | null): string | undefined {
  if (!cpId || !Array.isArray(attendees)) return undefined;
  for (const a of attendees) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    const pid = pickStr(o.provider_id) || pickStr(o.attendee_provider_id) || pickStr(o.member_id);
    if (pid !== cpId) continue;
    const n =
      pickStr(o.name) ||
      pickStr(o.attendee_name) ||
      pickStr(o.full_name) ||
      [pickStr(o.first_name), pickStr(o.last_name)].filter(Boolean).join(" ").trim();
    if (n) return n;
  }
  return undefined;
}

/**
 * Best-effort name from a Unipile **message** object (list messages API) plus optional counterparty id.
 */
export function extractSenderNameFromUnipileMessageShape(
  m: Record<string, unknown>,
  cpId: string | null
): string {
  const fromAttendees = nameFromAttendees(m.attendees, cpId);
  if (fromAttendees) return fromAttendees;

  const sender = m.sender;
  if (sender && typeof sender === "object") {
    const o = sender as Record<string, unknown>;
    const n =
      pickStr(o.attendee_name) ||
      pickStr(o.name) ||
      pickStr(o.full_name) ||
      [pickStr(o.first_name), pickStr(o.last_name)].filter(Boolean).join(" ").trim();
    if (n) return n;
  }

  const from = m.from;
  if (from && typeof from === "object") {
    const o = from as Record<string, unknown>;
    const n =
      pickStr(o.name) ||
      pickStr(o.full_name) ||
      [pickStr(o.first_name), pickStr(o.last_name)].filter(Boolean).join(" ").trim();
    if (n) return n;
  }

  return (
    pickStr(m.sender_name) ||
    pickStr(m.from_name) ||
    pickStr(m.author_name) ||
    pickStr(m.user_name) ||
    pickStr(m.display_name) ||
    ""
  );
}

export function inboundProviderIdFromWebhookPayload(payload: {
  sender?: {
    attendee_provider_id?: string;
    provider_id?: string;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}): string {
  const s = payload.sender;
  if (s && typeof s === "object") {
    const o = s as Record<string, unknown>;
    const id = pickStr(o.attendee_provider_id) || pickStr(o.provider_id);
    if (id) return id;
  }
  const p = payload as Record<string, unknown>;
  return (
    pickStr(p.sender_provider_id) ||
    pickStr(p.provider_id) ||
    pickStr(p.user_provider_id) ||
    ""
  );
}

/** Live webhook body — field names differ from GET /chats/.../messages. */
export function initialInboundNameFromWebhookPayload(payload: {
  sender?: { attendee_name?: string; name?: string; first_name?: string; last_name?: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}): string {
  const s = payload.sender;
  if (s && typeof s === "object") {
    const o = s as Record<string, unknown>;
    const n =
      pickStr(o.attendee_name) ||
      pickStr(o.name) ||
      [pickStr(o.first_name), pickStr(o.last_name)].filter(Boolean).join(" ").trim();
    if (n) return n;
  }
  const p = payload as Record<string, unknown>;
  return (
    pickStr(p.sender_name) ||
    pickStr(p.from_name) ||
    pickStr(p.author_name) ||
    pickStr(p.user_name) ||
    pickStr(p.display_name) ||
    "Unknown"
  );
}

function isUnknownName(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === "" || t === "unknown";
}

/**
 * If the message payload has no usable name but we have a LinkedIn provider id, fetch Unipile profile.
 */
export async function resolveInboundSenderDisplayName(args: {
  displayName: string;
  providerId: string;
}): Promise<string> {
  const raw = (args.displayName || "").trim();
  const pid = (args.providerId || "").trim();
  if (!isUnknownName(raw)) return raw;
  if (!pid) return raw || "Unknown";
  if (!isUnipileConfigured()) return raw || "Unknown";

  try {
    const data = await fetchUnipileLinkedInProfile(pid);
    const fields = extractUnipileProfileCrmFields(data);
    if (fields) {
      const full = [fields.firstName, fields.lastName].filter(Boolean).join(" ").trim();
      if (full) return full;
    }
    if (data && typeof data === "object") {
      const o = data as Record<string, unknown>;
      const n = pickStr(o.name);
      if (n) return n;
    }
  } catch {
    /* ignore */
  }

  return raw || "Unknown";
}
