/**
 * Send LinkedIn DMs via Unipile REST API (same contract as scripts/linkedin_unipile.sh send-message).
 */

import {
  fetchUnipileLinkedInProfile,
  isUnipileConfigured,
  normalizeUnipileDsn,
} from "./unipile-profile";
import { pushUnipileObservabilityLog } from "./unipile-observability-buffer";

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Resolve vanity/slug/URL segment to LinkedIn provider_id (ACoA…) for messaging. */
export async function resolveUnipileLinkedInProviderId(
  identifier: string
): Promise<string | null> {
  const id = identifier.trim();
  if (!id) return null;
  if (/^ACoA[A-Za-z0-9_-]+/i.test(id)) return id;

  const raw = await fetchUnipileLinkedInProfile(id);
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pid = pickStr(o.provider_id);
  return pid || null;
}

export type UnipileSendResult =
  | { ok: true; httpStatus: number; body: unknown }
  | { ok: false; httpStatus?: number; error: string; body?: unknown };

/**
 * POST /api/v1/chats — multipart: account_id, attendees_ids (provider id), text
 */
export async function sendUnipileLinkedInMessage(
  providerId: string,
  plainText: string
): Promise<UnipileSendResult> {
  const key = process.env.UNIPILE_API_KEY;
  const dsn = normalizeUnipileDsn(process.env.UNIPILE_DSN);
  const accountId = process.env.UNIPILE_ACCOUNT_ID;
  if (!key?.trim() || !dsn || !accountId?.trim()) {
    return { ok: false, error: "Unipile not configured (UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_ACCOUNT_ID)" };
  }

  const text = plainText.trim();
  if (!text) {
    return { ok: false, error: "Message body is empty" };
  }

  const base = `https://${dsn}/api/v1`;
  const url = `${base}/chats`;

  const form = new FormData();
  form.set("account_id", accountId);
  form.set("attendees_ids", providerId);
  form.set("text", text);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-KEY": key,
        accept: "application/json",
      },
      body: form,
      cache: "no-store",
    });
    const rawText = await res.text();
    let body: unknown = rawText;
    try {
      body = JSON.parse(rawText) as unknown;
    } catch {
      /* keep string */
    }
    if (!res.ok) {
      const errMsg =
        typeof body === "object" && body !== null && "detail" in body
          ? String((body as { detail?: string }).detail)
          : typeof body === "object" && body !== null && "message" in body
            ? String((body as { message?: string }).message)
            : rawText.slice(0, 500);
      pushUnipileObservabilityLog(
        `[unipile-lab] ${JSON.stringify(
          {
            kind: "unipile_send_dm",
            ok: false,
            httpStatus: res.status,
            error: (errMsg || `HTTP ${res.status}`).slice(0, 800),
            bodySnippet:
              typeof body === "string" ? body.slice(0, 600) : JSON.stringify(body).slice(0, 800),
          },
          null,
          2
        )}`
      );
      return {
        ok: false,
        httpStatus: res.status,
        error: errMsg || `HTTP ${res.status}`,
        body,
      };
    }
    pushUnipileObservabilityLog(
      `[unipile-lab] ${JSON.stringify(
        {
          kind: "unipile_send_dm",
          ok: true,
          httpStatus: res.status,
          bodySnippet:
            typeof body === "string" ? body.slice(0, 600) : JSON.stringify(body).slice(0, 800),
        },
        null,
        2
      )}`
    );
    return { ok: true, httpStatus: res.status, body };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushUnipileObservabilityLog(
      `[unipile-lab] ${JSON.stringify({ kind: "unipile_send_dm", ok: false, error: msg.slice(0, 800) }, null, 2)}`
    );
    return { ok: false, error: msg };
  }
}

/** Resolve recipient identifier then send. */
export async function sendWarmOutreachLinkedInDm(
  recipientIdentifier: string,
  plainText: string
): Promise<UnipileSendResult> {
  if (!isUnipileConfigured()) {
    return { ok: false, error: "Unipile not configured" };
  }
  const providerId = await resolveUnipileLinkedInProviderId(recipientIdentifier);
  if (!providerId) {
    return {
      ok: false,
      error:
        "Could not resolve LinkedIn recipient to provider_id. Use an ACoA… id from the profile, or a URL/slug Unipile can look up.",
    };
  }
  return sendUnipileLinkedInMessage(providerId, plainText);
}
