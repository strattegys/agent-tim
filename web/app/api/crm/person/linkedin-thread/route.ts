import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  isLinkedInProviderMemberId,
  postgresMissingColumn,
  resolveUnipilePersonIdentifier,
} from "@/lib/linkedin-person-identity";
import { fetchLinkedInThreadForProviderMemberId } from "@/lib/unipile-person-chat-thread";
import { resolveUnipileLinkedInProviderId } from "@/lib/unipile-send";

/**
 * GET ?personId=<uuid> — Load LinkedIn DM thread from Unipile for this CRM person (connection note + messages).
 * Does not write to the database.
 */
export async function GET(req: NextRequest) {
  const personId = req.nextUrl.searchParams.get("personId")?.trim();
  if (!personId) {
    return NextResponse.json({ error: "personId is required" }, { status: 400 });
  }

  let linkedinUrl: string | null = null;
  let linkedinProviderId: string | null = null;

  try {
    const rows = await query<{ linkedinUrl: string | null; linkedinProviderId: string | null }>(
      `SELECT p."linkedinLinkPrimaryLinkUrl" AS "linkedinUrl",
              p."linkedinProviderId" AS "linkedinProviderId"
       FROM person p
       WHERE p.id = $1 AND p."deletedAt" IS NULL
       LIMIT 1`,
      [personId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }
    linkedinUrl = rows[0]?.linkedinUrl?.trim() || null;
    linkedinProviderId = rows[0]?.linkedinProviderId?.trim() || null;
  } catch (e) {
    if (!postgresMissingColumn(e, "linkedinProviderId")) {
      console.error("[person/linkedin-thread] person query", e);
      return NextResponse.json({ error: "Failed to load person" }, { status: 500 });
    }
    const rows = await query<{ linkedinUrl: string | null }>(
      `SELECT p."linkedinLinkPrimaryLinkUrl" AS "linkedinUrl"
       FROM person p
       WHERE p.id = $1 AND p."deletedAt" IS NULL
       LIMIT 1`,
      [personId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }
    linkedinUrl = rows[0]?.linkedinUrl?.trim() || null;
    linkedinProviderId = null;
  }

  const hint = resolveUnipilePersonIdentifier({
    linkedinLinkPrimaryLinkUrl: linkedinUrl,
    linkedinProviderId,
  });

  if (!hint) {
    return NextResponse.json({
      ok: false,
      error:
        "No LinkedIn identity on this contact — add linkedinProviderId (ACoA…) and/or a profile URL in CRM so Unipile can find the thread.",
      messages: [],
      chatId: null,
      scannedChats: 0,
    });
  }

  let memberId = hint;
  if (!isLinkedInProviderMemberId(hint)) {
    memberId = (await resolveUnipileLinkedInProviderId(hint)) || "";
  }

  if (!memberId || !isLinkedInProviderMemberId(memberId)) {
    return NextResponse.json({
      ok: false,
      error:
        "Could not resolve this profile to a LinkedIn member id (ACoA…). Check the URL or set linkedinProviderId on the person row.",
      messages: [],
      chatId: null,
      scannedChats: 0,
    });
  }

  const thread = await fetchLinkedInThreadForProviderMemberId(memberId);
  if (!thread.ok) {
    return NextResponse.json({
      ok: false,
      error: thread.error,
      messages: [],
      chatId: null,
      scannedChats: thread.scannedChats ?? 0,
    });
  }

  return NextResponse.json({
    ok: true,
    chatId: thread.chatId,
    messages: thread.messages,
    scannedChats: thread.scannedChats,
    resolution: thread.resolution,
    resolvedProviderIdPrefix: `${memberId.slice(0, 10)}…`,
  });
}
