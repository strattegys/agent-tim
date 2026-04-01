/**
 * CRM cleanup: merge duplicate `person` rows that share LinkedIn identity and the same display name,
 * and optionally soft-delete empty contacts (name but no LinkedIn, no notes, no workflow items, no receipts, no artifacts).
 *
 * Safe defaults: **dry-run** unless you pass `--apply`.
 *
 * Usage (from `web/` with CRM in `.env.local`):
 *   npx tsx scripts/cleanup-person-duplicates.ts
 *   npx tsx scripts/cleanup-person-duplicates.ts --apply
 *   npx tsx scripts/cleanup-person-duplicates.ts --apply --prune-empty
 *   npx tsx scripts/cleanup-person-duplicates.ts --fix-packaged-workflows
 *   npx tsx scripts/cleanup-person-duplicates.ts --apply --fix-packaged-workflows
 *
 * `--fix-packaged-workflows` — people with 2+ rows on **blocking** package pipelines (ACTIVE / PAUSED /
 * DRAFT / PENDING_APPROVAL) get a single keeper row: prefers customer packages over Tim LinkedIn intake,
 * then newest activity. Artifacts move to the keeper row; extra `_workflow_item` rows are soft-deleted.
 *
 * `npm run cleanup:person-dupes` loads `web/.env.local` via Node `--env-file` so CRM connects before `lib/db` initializes.
 *
 * With server-only preload (same as other CRM scripts):
 *   npm run cleanup:person-dupes
 *   npm run cleanup:person-dupes -- --apply
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { extractLinkedInProfileIdentifier } from "../lib/unipile-profile";
import {
  isLinkedInProviderMemberId,
  linkedinUrlJsonCoalesceUnsupported,
  normalizeUnipileProviderToken,
  postgresMissingColumn,
} from "../lib/linkedin-person-identity";
import { query, transaction } from "../lib/db";
import {
  findPersonBlockingPackagedWorkflowItems,
  isTimLinkedInSystemPackageTemplateId,
  type BlockingPackagedWorkflowItem,
} from "../lib/person-packaged-workflow-exclusivity";
import { syncHumanTaskOpenForItem } from "../lib/workflow-item-human-task";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(WEB_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("Missing web/.env.local");
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    const k = m[1];
    if (process.env[k] === undefined || process.env[k] === "") process.env[k] = v;
  }
}

type PersonRow = {
  id: string;
  nameFirstName: string | null;
  nameLastName: string | null;
  linkedinProviderId: string | null;
  linkedinLinkPrimaryLinkUrl: string | null;
  jobTitle: string | null;
  emailsPrimaryEmail: string | null;
  companyId: string | null;
  updatedAt: string;
};

function normNamePart(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizedFullName(p: PersonRow): string {
  return `${normNamePart(p.nameFirstName)} ${normNamePart(p.nameLastName)}`.trim();
}

/** Stable key for grouping: member id preferred, else normalized /in/ vanity slug. */
function linkedinIdentityKey(p: PersonRow): string | null {
  const pid = normalizeUnipileProviderToken(p.linkedinProviderId || "");
  if (pid && isLinkedInProviderMemberId(pid)) {
    return `member:${pid.toLowerCase()}`;
  }
  const url = (p.linkedinLinkPrimaryLinkUrl || "").trim();
  if (!url) return null;
  const id = extractLinkedInProfileIdentifier(url);
  if (!id) return null;
  if (isLinkedInProviderMemberId(id)) {
    return `member:${id.toLowerCase()}`;
  }
  return `vanity:${id.toLowerCase()}`;
}

function hasAnyLinkedin(p: PersonRow): boolean {
  return linkedinIdentityKey(p) != null;
}

async function loadPersons(): Promise<PersonRow[]> {
  const baseFields = (pidSelect: string) => `SELECT p.id::text,
            p."nameFirstName",
            p."nameLastName",
            ${pidSelect},
            p."jobTitle",
            p."emailsPrimaryEmail",
            p."companyId"::text,
            p."updatedAt"::text`;
  const pidCol = `p."linkedinProviderId"`;
  const pidNull = `NULL::text AS "linkedinProviderId"`;
  const urlJsonb = `COALESCE(
              NULLIF(TRIM(p."linkedinLinkPrimaryLinkUrl"), ''),
              NULLIF(TRIM(p."linkedinUrl"->>'value'), ''),
              NULLIF(TRIM(p."linkedinUrl"->>'primaryLinkUrl'), ''),
              NULLIF(TRIM(p."linkedinUrl"->'primaryLinkUrl'->>'value'), '')
            ) AS "linkedinLinkPrimaryLinkUrl"`;
  const urlFlat = `NULLIF(TRIM(p."linkedinLinkPrimaryLinkUrl"), '') AS "linkedinLinkPrimaryLinkUrl"`;

  async function tryLoad(pidSelect: string, urlSelect: string): Promise<PersonRow[]> {
    return query<PersonRow>(
      `${baseFields(pidSelect)},
            ${urlSelect}
     FROM person p
     WHERE p."deletedAt" IS NULL`
    );
  }

  for (const pid of [pidCol, pidNull] as const) {
    try {
      return await tryLoad(pid, urlJsonb);
    } catch (e) {
      if (linkedinUrlJsonCoalesceUnsupported(e)) {
        try {
          return await tryLoad(pid, urlFlat);
        } catch (e2) {
          if (pid === pidCol && postgresMissingColumn(e2, "linkedinProviderId")) continue;
          throw e2;
        }
      }
      if (pid === pidCol && postgresMissingColumn(e, "linkedinProviderId")) continue;
      throw e;
    }
  }
  return [];
}

async function personTableHasLinkedinProviderId(): Promise<boolean> {
  try {
    await query(`SELECT "linkedinProviderId" FROM person LIMIT 0`);
    return true;
  } catch (e) {
    if (postgresMissingColumn(e, "linkedinProviderId")) return false;
    throw e;
  }
}

async function scorePerson(id: string): Promise<number> {
  const [nt, wi, rc, art] = await Promise.all([
    query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "noteTarget" nt
       WHERE nt."targetPersonId" = $1::uuid AND nt."deletedAt" IS NULL`,
      [id]
    ),
    query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "_workflow_item" wi
       WHERE wi."sourceType" = 'person' AND wi."sourceId" = $1::uuid AND wi."deletedAt" IS NULL`,
      [id]
    ),
    query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "_linkedin_inbound_receipt"
       WHERE "personId" = $1::uuid`,
      [id]
    ),
    query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM "_artifact" a
       INNER JOIN "_workflow_item" wi ON wi.id = a."workflowItemId" AND wi."deletedAt" IS NULL
       WHERE wi."sourceType" = 'person' AND wi."sourceId" = $1::uuid
         AND a."deletedAt" IS NULL`,
      [id]
    ),
  ]);
  const n = (x: { c: string }[]) => parseInt(x[0]?.c || "0", 10) || 0;
  return n(nt) * 1000 + n(wi) * 500 + n(rc) * 50 + n(art) * 10;
}

async function pickKeeper(ids: string[]): Promise<string> {
  const scored: { id: string; sc: number; updatedAt: string }[] = [];
  for (const id of ids) {
    const sc = await scorePerson(id);
    const u = await query<{ u: string }>(
      `SELECT "updatedAt"::text AS u FROM person WHERE id = $1::uuid`,
      [id]
    );
    scored.push({ id, sc, updatedAt: u[0]?.u || "" });
  }
  scored.sort((a, b) => {
    if (b.sc !== a.sc) return b.sc - a.sc;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  return scored[0].id;
}

async function mergeOneLoserIntoKeeper(
  run: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>,
  loser: PersonRow,
  keeperId: string,
  personHasLinkedinProviderId: boolean
): Promise<string[]> {
  const loserId = loser.id;
  const touchedKeeperItems: string[] = [];

  await run(
    `UPDATE "noteTarget" nt
     SET "deletedAt" = NOW(), "updatedAt" = NOW()
     WHERE nt."targetPersonId" = $1::uuid
       AND nt."deletedAt" IS NULL
       AND EXISTS (
         SELECT 1 FROM "noteTarget" nt2
         WHERE nt2."noteId" = nt."noteId"
           AND nt2."targetPersonId" = $2::uuid
           AND nt2."deletedAt" IS NULL
       )`,
    [loserId, keeperId]
  );

  await run(
    `UPDATE "noteTarget"
     SET "targetPersonId" = $2::uuid, "updatedAt" = NOW()
     WHERE "targetPersonId" = $1::uuid AND "deletedAt" IS NULL`,
    [loserId, keeperId]
  );

  await run(
    `DELETE FROM "_linkedin_inbound_receipt" r1
     WHERE r1."personId" = $1::uuid
       AND EXISTS (
         SELECT 1 FROM "_linkedin_inbound_receipt" r2
         WHERE r2."unipileMessageId" = r1."unipileMessageId"
           AND r2."personId" = $2::uuid
       )`,
    [loserId, keeperId]
  );

  await run(
    `UPDATE "_linkedin_inbound_receipt" SET "personId" = $2::uuid WHERE "personId" = $1::uuid`,
    [loserId, keeperId]
  );

  const loserItems = await run(
    `SELECT id::text AS id, "workflowId"::text AS "workflowId"
     FROM "_workflow_item"
     WHERE "sourceType" = 'person' AND "sourceId" = $1::uuid AND "deletedAt" IS NULL`,
    [loserId]
  );

  for (const row of loserItems.rows as { id: string; workflowId: string }[]) {
    const wiId = row.id;
    const wfId = row.workflowId;
    const keeperWi = await run(
      `SELECT id::text AS id FROM "_workflow_item"
       WHERE "workflowId" = $1::uuid
         AND "sourceType" = 'person'
         AND "sourceId" = $2::uuid
         AND "deletedAt" IS NULL
       LIMIT 1`,
      [wfId, keeperId]
    );
    const keeperWiId = (keeperWi.rows[0] as { id?: string } | undefined)?.id;
    if (keeperWiId) {
      await run(
        `UPDATE "_artifact"
         SET "workflowItemId" = $1::uuid, "updatedAt" = NOW()
         WHERE "workflowItemId" = $2::uuid AND "deletedAt" IS NULL`,
        [keeperWiId, wiId]
      );
      await run(
        `UPDATE "_workflow_item"
         SET "deletedAt" = NOW(), "humanTaskOpen" = false, "updatedAt" = NOW()
         WHERE id = $1::uuid`,
        [wiId]
      );
      touchedKeeperItems.push(keeperWiId);
    } else {
      await run(
        `UPDATE "_workflow_item"
         SET "sourceId" = $2::uuid, "updatedAt" = NOW()
         WHERE id = $1::uuid AND "deletedAt" IS NULL`,
        [wiId, keeperId]
      );
      touchedKeeperItems.push(wiId);
    }
  }

  const lp = (loser.linkedinProviderId || "").trim() || null;
  const lu = (loser.linkedinLinkPrimaryLinkUrl || "").trim() || null;
  const em = (loser.emailsPrimaryEmail || "").trim() || null;
  /** Clear loser email before copying onto keeper — global unique on `emailsPrimaryEmail` would see two rows. */
  if (em) {
    await run(
      `UPDATE person SET "emailsPrimaryEmail" = NULL, "updatedAt" = NOW() WHERE id = $1::uuid AND "deletedAt" IS NULL`,
      [loserId]
    );
  }
  if (personHasLinkedinProviderId) {
    await run(
      `UPDATE person SET
         "linkedinProviderId" = COALESCE(NULLIF(TRIM("linkedinProviderId"), ''), $2::text),
         "linkedinLinkPrimaryLinkUrl" = COALESCE(NULLIF(TRIM("linkedinLinkPrimaryLinkUrl"), ''), $3::text),
         "emailsPrimaryEmail" = COALESCE(NULLIF(TRIM("emailsPrimaryEmail"), ''), $4::text),
         "updatedAt" = NOW()
       WHERE id = $1::uuid AND "deletedAt" IS NULL`,
      [keeperId, lp, lu, em]
    );
  } else {
    await run(
      `UPDATE person SET
         "linkedinLinkPrimaryLinkUrl" = COALESCE(NULLIF(TRIM("linkedinLinkPrimaryLinkUrl"), ''), $2::text),
         "emailsPrimaryEmail" = COALESCE(NULLIF(TRIM("emailsPrimaryEmail"), ''), $3::text),
         "updatedAt" = NOW()
       WHERE id = $1::uuid AND "deletedAt" IS NULL`,
      [keeperId, lu, em]
    );
  }
  const coRaw = (loser.companyId || "").trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(coRaw)) {
    await run(
      `UPDATE person
       SET "companyId" = COALESCE("companyId", $2::uuid), "updatedAt" = NOW()
       WHERE id = $1::uuid AND "deletedAt" IS NULL`,
      [keeperId, coRaw]
    );
  }

  await run(
    `UPDATE person SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1::uuid AND "deletedAt" IS NULL`,
    [loserId]
  );

  return [...new Set(touchedKeeperItems)];
}

function scoreBlockingPackagedItem(r: BlockingPackagedWorkflowItem): number {
  let s = 0;
  if (!isTimLinkedInSystemPackageTemplateId(r.templateId)) s += 1e15;
  const t = Date.parse(r.itemUpdatedAt);
  if (Number.isFinite(t)) s += t / 1000;
  return s;
}

async function runFixPackagedWorkflowOverlaps(apply: boolean): Promise<void> {
  const dupPersons = await query<{ sid: string }>(
    `SELECT wi."sourceId"::text AS sid
     FROM "_workflow_item" wi
     INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
     INNER JOIN "_package" p ON p.id = w."packageId" AND p."deletedAt" IS NULL
     WHERE wi."sourceType" = 'person'
       AND wi."deletedAt" IS NULL
       AND UPPER(TRIM(COALESCE(p.stage::text, ''))) IN ('ACTIVE', 'PAUSED', 'DRAFT', 'PENDING_APPROVAL')
     GROUP BY wi."sourceId"
     HAVING COUNT(*) > 1`
  );

  console.log(
    `\n[cleanup-person-dupes] Packaged-workflow overlap: ${dupPersons.length} person(s) with 2+ rows on blocking package pipelines.`
  );
  if (dupPersons.length === 0) return;

  for (const { sid } of dupPersons) {
    const rows = await findPersonBlockingPackagedWorkflowItems(sid);
    if (rows.length < 2) continue;

    const sorted = [...rows].sort((a, b) => scoreBlockingPackagedItem(b) - scoreBlockingPackagedItem(a));
    const keeper = sorted[0];
    const losers = sorted.slice(1);

    console.log(
      `\n  Person ${sid.slice(0, 8)}… — keeper item ${keeper.itemId.slice(0, 8)}… ` +
        `(${keeper.packageName || keeper.templateId} / ${keeper.workflowName})`
    );
    for (const l of losers) {
      console.log(
        `    remove: item ${l.itemId.slice(0, 8)}… — ${l.packageName || l.templateId} / ${l.workflowName}`
      );
    }

    if (apply) {
      await transaction(async (run) => {
        for (const l of losers) {
          await run(
            `UPDATE "_artifact"
             SET "workflowItemId" = $1::uuid, "updatedAt" = NOW()
             WHERE "workflowItemId" = $2::uuid AND "deletedAt" IS NULL`,
            [keeper.itemId, l.itemId]
          );
          await run(
            `UPDATE "_workflow_item"
             SET "deletedAt" = NOW(), "humanTaskOpen" = false, "updatedAt" = NOW()
             WHERE id = $1::uuid AND "deletedAt" IS NULL`,
            [l.itemId]
          );
        }
      });
      await syncHumanTaskOpenForItem(keeper.itemId);
      console.log(`  [applied] collapsed to one row; synced humanTaskOpen on keeper.`);
    }
  }

  if (!apply) {
    console.log(
      "\n[cleanup-person-dupes] Dry-run: pass --apply --fix-packaged-workflows to soft-delete extra rows and move artifacts."
    );
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pruneEmpty = process.argv.includes("--prune-empty");
  const fixPackagedWorkflows = process.argv.includes("--fix-packaged-workflows");

  loadEnvLocal();

  const personHasLinkedinProviderId = await personTableHasLinkedinProviderId();
  const persons = await loadPersons();
  const byKey = new Map<string, PersonRow[]>();
  for (const p of persons) {
    const key = linkedinIdentityKey(p);
    if (!key) continue;
    const name = normalizedFullName(p);
    if (!name) continue;
    const gk = `${key}||${name}`;
    const arr = byKey.get(gk) || [];
    arr.push(p);
    byKey.set(gk, arr);
  }

  const duplicateGroups: PersonRow[][] = [...byKey.values()].filter((g) => g.length > 1);

  console.log(
    `[cleanup-person-dupes] Loaded ${persons.length} active persons; ` +
      `${duplicateGroups.length} duplicate group(s) (same LinkedIn key + same normalized name).`
  );

  if (duplicateGroups.length === 0) {
    console.log("[cleanup-person-dupes] No LinkedIn+name duplicate groups to merge.");
  } else {
    for (const g of duplicateGroups) {
      const ids = g.map((p) => p.id);
      const keeperId = await pickKeeper(ids);
      const losers = ids.filter((id) => id !== keeperId);
      const keeper = g.find((p) => p.id === keeperId)!;
      console.log(
        `\n[cleanup-person-dupes] Group (${g.length}): keeper=${keeperId} ` +
          `(${normNamePart(keeper.nameFirstName)} ${normNamePart(keeper.nameLastName)})`
      );
      console.log(`  merge away: ${losers.join(", ")}`);
      for (const p of g) {
        console.log(
          `    - ${p.id}  ${normNamePart(p.nameFirstName)} ${normNamePart(p.nameLastName)}  ` +
            `pid=${(p.linkedinProviderId || "").slice(0, 12) || "—"}  url=${(p.linkedinLinkPrimaryLinkUrl || "").slice(0, 48) || "—"}`
        );
      }

      if (apply) {
        for (const loserId of losers) {
          const loserRow = g.find((p) => p.id === loserId)!;
          const touched = await transaction(async (run) => {
            return mergeOneLoserIntoKeeper(run, loserRow, keeperId, personHasLinkedinProviderId);
          });
          for (const wi of touched) {
            await syncHumanTaskOpenForItem(wi);
          }
          console.log(`  [applied] merged ${loserId} → ${keeperId}, synced ${touched.length} workflow item(s).`);
        }
      }
    }
    if (!apply) {
      console.log("\n[cleanup-person-dupes] Dry-run only. Re-run with --apply to execute merges.");
    }
  }

  if (pruneEmpty) {
    const forPrune = apply ? await loadPersons() : persons;
    const candidates: PersonRow[] = [];
    for (const p of forPrune) {
      if (hasAnyLinkedin(p)) continue;
      const fn = normNamePart(p.nameFirstName);
      const ln = normNamePart(p.nameLastName);
      if (!fn && !ln) continue;

      const [nt, wi, rc, art] = await Promise.all([
        query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM "noteTarget" nt
           WHERE nt."targetPersonId" = $1::uuid AND nt."deletedAt" IS NULL`,
          [p.id]
        ),
        query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM "_workflow_item" wi
           WHERE wi."sourceId" = $1::uuid AND wi."deletedAt" IS NULL`,
          [p.id]
        ),
        query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM "_linkedin_inbound_receipt" WHERE "personId" = $1::uuid`,
          [p.id]
        ),
        query<{ c: string }>(
          `SELECT COUNT(*)::text AS c
           FROM "_artifact" a
           INNER JOIN "_workflow_item" wi ON wi.id = a."workflowItemId" AND wi."deletedAt" IS NULL
           WHERE wi."sourceId" = $1::uuid AND a."deletedAt" IS NULL`,
          [p.id]
        ),
      ]);
      const n = (x: { c: string }[]) => parseInt(x[0]?.c || "0", 10) || 0;
      const total = n(nt) + n(wi) + n(rc) + n(art);
      if (total === 0) candidates.push(p);
    }

    console.log(
      `\n[cleanup-person-dupes] Prune-empty: ${candidates.length} person row(s) with name, no LinkedIn, no notes/workflow/receipts/artifacts.`
    );
    for (const p of candidates) {
      console.log(
        `  - ${p.id}  ${normNamePart(p.nameFirstName)} ${normNamePart(p.nameLastName)}`
      );
    }
    if (apply && candidates.length > 0) {
      for (const p of candidates) {
        await query(
          `UPDATE person SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1::uuid AND "deletedAt" IS NULL`,
          [p.id]
        );
        console.log(`  [applied] soft-deleted ${p.id}`);
      }
    } else if (pruneEmpty && !apply && candidates.length > 0) {
      console.log("[cleanup-person-dupes] Dry-run: pass --apply with --prune-empty to soft-delete these.");
    }
  }

  if (fixPackagedWorkflows) {
    await runFixPackagedWorkflowOverlaps(apply);
  }

  console.log("\n[cleanup-person-dupes] Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
