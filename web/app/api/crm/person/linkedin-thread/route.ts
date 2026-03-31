import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  isLinkedInProviderMemberId,
  linkedinUrlJsonCoalesceUnsupported,
  postgresMissingColumn,
  resolveUnipilePersonIdentifier,
  sqlPersonLinkedinUrlCoalesce,
} from "@/lib/linkedin-person-identity";
import { applyUnipileResearchToPerson } from "@/lib/warm-contact-intake-apply";
import { fetchLinkedInThreadForProviderMemberId } from "@/lib/unipile-person-chat-thread";
import { fetchUnipileLinkedInProfile } from "@/lib/unipile-profile";
import { resolveUnipileLinkedInProviderId } from "@/lib/unipile-send";

async function bumpWorkflowItemsForPerson(personId: string): Promise<void> {
  await query(
    `UPDATE "_workflow_item" SET "updatedAt" = NOW()
     WHERE "sourceType" = 'person' AND "sourceId" = $1::uuid AND "deletedAt" IS NULL`,
    [personId]
  );
}

/** Concatenate recent artifacts for this person so `**Provider id:**` from inbound LinkedIn rows can resolve Unipile. */
async function loadArtifactNotesFallbackForPerson(
  personId: string,
  preferredWorkflowItemId: string | null
): Promise<string> {
  try {
    const rows = await query<{ content: string }>(
      `SELECT a.content::text AS content
       FROM "_artifact" a
       INNER JOIN "_workflow_item" wi ON wi.id = a."workflowItemId"
       WHERE wi."sourceType" = 'person'
         AND wi."sourceId" = $1::uuid
         AND wi."deletedAt" IS NULL
         AND a."deletedAt" IS NULL
       ORDER BY
         CASE
           WHEN $2::uuid IS NOT NULL AND a."workflowItemId" = $2::uuid THEN 0
           ELSE 1
         END,
         a."createdAt" DESC NULLS LAST
       LIMIT 30`,
      [personId, preferredWorkflowItemId?.trim() || null]
    );
    return rows.map((r) => r.content).join("\n\n");
  } catch (e) {
    console.warn("[person/linkedin-thread] artifact notes fallback:", e);
    return "";
  }
}

async function loadPersonLinkedInFields(personId: string): Promise<{
  linkedinUrl: string | null;
  linkedinProviderId: string | null;
}> {
  try {
    const rows = await query<{ linkedinUrl: string | null; linkedinProviderId: string | null }>(
      `SELECT ${sqlPersonLinkedinUrlCoalesce("p")} AS "linkedinUrl",
              p."linkedinProviderId" AS "linkedinProviderId"
       FROM person p
       WHERE p.id = $1::uuid AND p."deletedAt" IS NULL
       LIMIT 1`,
      [personId]
    );
    if (rows.length === 0) return { linkedinUrl: null, linkedinProviderId: null };
    return {
      linkedinUrl: rows[0]?.linkedinUrl?.trim() || null,
      linkedinProviderId: rows[0]?.linkedinProviderId?.trim() || null,
    };
  } catch (e) {
    if (linkedinUrlJsonCoalesceUnsupported(e)) {
      try {
        const rows = await query<{ linkedinUrl: string | null; linkedinProviderId: string | null }>(
          `SELECT NULLIF(TRIM(p."linkedinLinkPrimaryLinkUrl"), '') AS "linkedinUrl",
                  p."linkedinProviderId" AS "linkedinProviderId"
           FROM person p
           WHERE p.id = $1::uuid AND p."deletedAt" IS NULL
           LIMIT 1`,
          [personId]
        );
        if (rows.length === 0) return { linkedinUrl: null, linkedinProviderId: null };
        return {
          linkedinUrl: rows[0]?.linkedinUrl?.trim() || null,
          linkedinProviderId: rows[0]?.linkedinProviderId?.trim() || null,
        };
      } catch (eFlat) {
        if (!postgresMissingColumn(eFlat, "linkedinProviderId")) throw eFlat;
      }
    } else if (!postgresMissingColumn(e, "linkedinProviderId")) {
      throw e;
    }
    const rows = await query<{ linkedinUrl: string | null }>(
      `SELECT NULLIF(TRIM(p."linkedinLinkPrimaryLinkUrl"), '') AS "linkedinUrl"
       FROM person p
       WHERE p.id = $1::uuid AND p."deletedAt" IS NULL
       LIMIT 1`,
      [personId]
    );
    if (rows.length === 0) return { linkedinUrl: null, linkedinProviderId: null };
    return {
      linkedinUrl: rows[0]?.linkedinUrl?.trim() || null,
      linkedinProviderId: null,
    };
  }
}

/**
 * GET ?personId=<uuid>&workflowItemId=<uuid optional> — Load LinkedIn DM thread from Unipile for this CRM person.
 * Resolves identity from person columns (including jsonb `linkedinUrl` coalesce), then from workflow artifacts
 * (e.g. `**Provider id:**` on LinkedIn inbound rows). Optional `workflowItemId` prioritizes that item’s artifacts.
 * Also merges Unipile `GET /users/{memberId}` into the `person` row when possible.
 */
export async function GET(req: NextRequest) {
  const personId = req.nextUrl.searchParams.get("personId")?.trim();
  const workflowItemId = req.nextUrl.searchParams.get("workflowItemId")?.trim() || null;
  if (!personId) {
    return NextResponse.json({ error: "personId is required" }, { status: 400 });
  }

  const { linkedinUrl, linkedinProviderId } = await loadPersonLinkedInFields(personId);
  const personExists = await query<{ one: number }>(
    `SELECT 1 AS one FROM person p WHERE p.id = $1::uuid AND p."deletedAt" IS NULL LIMIT 1`,
    [personId]
  );
  if (personExists.length === 0) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  const artifactNotes = await loadArtifactNotesFallbackForPerson(personId, workflowItemId);
  const hint = resolveUnipilePersonIdentifier({
    linkedinLinkPrimaryLinkUrl: linkedinUrl,
    linkedinProviderId,
    notesFallback: artifactNotes || undefined,
  });

  if (!hint) {
    return NextResponse.json({
      ok: false,
      error:
        "No LinkedIn identity on this contact — add linkedinProviderId (ACoA…) and/or a profile URL in CRM so Unipile can find the thread.",
      messages: [],
      chatId: null,
      scannedChats: 0,
      personCrmSynced: false,
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
      personCrmSynced: false,
    });
  }

  let personCrmSynced = false;
  const personSyncLogs: string[] = [];
  try {
    const rawProfile = await fetchUnipileLinkedInProfile(memberId);
    personCrmSynced = await applyUnipileResearchToPerson(personId, rawProfile, personSyncLogs);
    if (personCrmSynced) {
      await bumpWorkflowItemsForPerson(personId);
    }
  } catch (e) {
    console.warn("[person/linkedin-thread] Unipile profile → CRM sync:", e);
  }

  const thread = await fetchLinkedInThreadForProviderMemberId(memberId);
  if (!thread.ok) {
    return NextResponse.json({
      ok: false,
      error: thread.error,
      messages: [],
      chatId: null,
      scannedChats: thread.scannedChats ?? 0,
      personCrmSynced,
      personSyncLogs: personSyncLogs.slice(-6),
    });
  }

  return NextResponse.json({
    ok: true,
    chatId: thread.chatId,
    messages: thread.messages,
    scannedChats: thread.scannedChats,
    resolution: thread.resolution,
    resolvedProviderIdPrefix: `${memberId.slice(0, 10)}…`,
    personCrmSynced,
    personSyncLogs: personSyncLogs.slice(-6),
  });
}
