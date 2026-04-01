import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  extractLinkedInHintFromArtifactOrNotes,
  extractUnipileInboundChatIdFromNotes,
  isLinkedInProviderMemberId,
  linkedinUrlJsonCoalesceUnsupported,
  postgresMissingColumn,
  resolveUnipilePersonIdentifier,
  sqlPersonLinkedinUrlCoalesce,
} from "@/lib/linkedin-person-identity";
import { applyUnipileResearchToPerson } from "@/lib/warm-contact-intake-apply";
import {
  fetchLinkedInThreadForProviderMemberId,
  tryFetchLinkedInThreadViaInboundChatId,
} from "@/lib/unipile-person-chat-thread";
import { fetchUnipileLinkedInProfile } from "@/lib/unipile-profile";
import { resolveUnipileLinkedInProviderId } from "@/lib/unipile-send";
import { healPersonLinkedInFromWorkflowArtifactsIfNeeded } from "@/lib/linkedin-general-inbox";

/** Some DB layers store artifact `content` as JSON — unwrap so Provider id / Chat ID lines are visible. */
function coalesceArtifactBody(raw: string | null | undefined): string {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (s.startsWith("{") && s.endsWith("}")) {
    try {
      const o = JSON.parse(s) as Record<string, unknown>;
      for (const k of ["markdown", "text", "body", "content", "value"]) {
        const v = o[k];
        if (typeof v === "string" && v.trim()) return v;
      }
    } catch {
      /* treat as plain text */
    }
  }
  return s;
}

async function bumpWorkflowItemsForPerson(personId: string): Promise<void> {
  await query(
    `UPDATE "_workflow_item" SET "updatedAt" = NOW()
     WHERE "sourceType" = 'person' AND "sourceId" = $1::uuid AND "deletedAt" IS NULL`,
    [personId]
  );
}

/**
 * Text blob for resolving Unipile member id when the `person` row has no LinkedIn fields.
 * 1) Artifacts on the **current queue item** (same as Tim “Queue snapshots”) — no join on `sourceId`,
 *    so this still works if `workflow_item.sourceId` drifted from the `personId` the client sends.
 * 2) Artifacts on any `sourceType = person` item for this person (excluding the same item ids already loaded).
 */
async function loadArtifactNotesFallbackForPerson(
  personId: string,
  preferredWorkflowItemId: string | null
): Promise<string> {
  const chunks: string[] = [];
  const wid = preferredWorkflowItemId?.trim() || null;
  try {
    if (wid) {
      const onItem = await query<{ content: string }>(
        `SELECT a.content::text AS content
         FROM "_artifact" a
         WHERE a."workflowItemId" = $1::uuid AND a."deletedAt" IS NULL
         ORDER BY a."createdAt" DESC NULLS LAST
         LIMIT 40`,
        [wid]
      );
      for (const r of onItem) {
        const c = r.content?.trim();
        if (c) chunks.push(c);
      }
    }
    const onPerson = await query<{ content: string }>(
      `SELECT a.content::text AS content
       FROM "_artifact" a
       INNER JOIN "_workflow_item" wi ON wi.id = a."workflowItemId"
       WHERE wi."sourceType" = 'person'
         AND wi."sourceId" = $1::uuid
         AND wi."deletedAt" IS NULL
         AND a."deletedAt" IS NULL
         AND ($2::uuid IS NULL OR a."workflowItemId" IS DISTINCT FROM $2::uuid)
       ORDER BY a."createdAt" DESC NULLS LAST
       LIMIT 30`,
      [personId, wid]
    );
    for (const r of onPerson) {
      const c = coalesceArtifactBody(r.content).trim();
      if (c) chunks.push(c);
    }
  } catch (e) {
    console.warn("[person/linkedin-thread] artifact notes fallback:", e);
  }
  return chunks.join("\n\n");
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

  let { linkedinUrl, linkedinProviderId } = await loadPersonLinkedInFields(personId);
  if (
    workflowItemId &&
    !(linkedinUrl || "").trim() &&
    !(linkedinProviderId || "").trim()
  ) {
    const healed = await healPersonLinkedInFromWorkflowArtifactsIfNeeded(personId, workflowItemId);
    if (healed) {
      const again = await loadPersonLinkedInFields(personId);
      linkedinUrl = again.linkedinUrl;
      linkedinProviderId = again.linkedinProviderId;
    }
  }
  const personExists = await query<{ one: number }>(
    `SELECT 1 AS one FROM person p WHERE p.id = $1::uuid AND p."deletedAt" IS NULL LIMIT 1`,
    [personId]
  );
  if (personExists.length === 0) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  const artifactNotes = await loadArtifactNotesFallbackForPerson(personId, workflowItemId);

  /** Prefer exact Unipile chat id from the inbound webhook artifact — works even when CRM has no LinkedIn fields or slug→ACoA resolution fails. */
  const inboundChatId = extractUnipileInboundChatIdFromNotes(artifactNotes);
  if (inboundChatId) {
    const direct = await tryFetchLinkedInThreadViaInboundChatId(inboundChatId);
    if (direct.ok) {
      let personCrmSynced = false;
      const personSyncLogs: string[] = [];
      const memberFromArt = extractLinkedInHintFromArtifactOrNotes(artifactNotes);
      if (memberFromArt && isLinkedInProviderMemberId(memberFromArt)) {
        try {
          const rawProfile = await fetchUnipileLinkedInProfile(memberFromArt);
          personCrmSynced = await applyUnipileResearchToPerson(personId, rawProfile, personSyncLogs);
          if (personCrmSynced) {
            await bumpWorkflowItemsForPerson(personId);
          }
        } catch (e) {
          console.warn("[person/linkedin-thread] Unipile profile → CRM sync (webhook chat path):", e);
        }
      }
      return NextResponse.json({
        ok: true,
        chatId: inboundChatId,
        messages: direct.messages,
        scannedChats: 0,
        resolution: "inbound_webhook_chat",
        resolvedProviderIdPrefix:
          memberFromArt && isLinkedInProviderMemberId(memberFromArt)
            ? `${memberFromArt.slice(0, 10)}…`
            : null,
        personCrmSynced,
        personSyncLogs: personSyncLogs.slice(-6),
      });
    }
  }

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
