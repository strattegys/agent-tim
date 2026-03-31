/**
 * Dev-only: seed Tim’s queue with deterministic test rows (Postgres CRM).
 * Used by POST /api/dev/seed-tim-test-queue and scripts/seed-tim-test-queue.ts.
 */

import { query, transaction } from "@/lib/db";
import { ensureGeneralLinkedInInboxWorkflowId } from "@/lib/linkedin-general-inbox";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";

const IDS = {
  personGi1: "feedbeef-1000-4000-8000-000000000001",
  personGi2: "feedbeef-1000-4000-8000-000000000002",
  personWarm: "feedbeef-1000-4000-8000-000000000003",
  package: "feedbeef-2000-4000-8000-000000000001",
} as const;

const PKG_NAME = "Dev — Tim test queue";

type RunRows = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

async function softDeleteSeed(run: RunRows): Promise<void> {
  const pids = [IDS.personGi1, IDS.personGi2, IDS.personWarm];

  const boardRows = await run(
    `SELECT DISTINCT w."boardId" AS "boardId" FROM "_workflow" w
     WHERE w."packageId" = $1::uuid AND w."deletedAt" IS NULL AND w."boardId" IS NOT NULL`,
    [IDS.package]
  );
  const boardIdList = boardRows
    .map((r) => r.boardId as string | null)
    .filter(Boolean) as string[];

  await run(
    `UPDATE "_artifact" SET "deletedAt" = NOW(), "updatedAt" = NOW()
     WHERE "deletedAt" IS NULL
       AND "workflowItemId" IN (
         SELECT wi.id FROM "_workflow_item" wi
         WHERE wi."deletedAt" IS NULL
           AND (
             wi."sourceId"::text = ANY($1::text[])
             OR wi."workflowId" IN (SELECT w.id FROM "_workflow" w WHERE w."packageId" = $2::uuid AND w."deletedAt" IS NULL)
           )
       )`,
    [pids, IDS.package]
  );

  await run(
    `UPDATE "_workflow_item" SET "deletedAt" = NOW(), "humanTaskOpen" = false, "updatedAt" = NOW()
     WHERE "deletedAt" IS NULL
       AND (
         "sourceId"::text = ANY($1::text[])
         OR "workflowId" IN (SELECT id FROM "_workflow" WHERE "packageId" = $2::uuid AND "deletedAt" IS NULL)
       )`,
    [pids, IDS.package]
  );

  await run(
    `UPDATE "_workflow" SET "deletedAt" = NOW(), "updatedAt" = NOW()
     WHERE "deletedAt" IS NULL AND "packageId" = $1::uuid`,
    [IDS.package]
  );

  if (boardIdList.length > 0) {
    await run(
      `UPDATE "_board" SET "deletedAt" = NOW(), "updatedAt" = NOW()
       WHERE id = ANY($1::uuid[]) AND "deletedAt" IS NULL`,
      [boardIdList]
    );
  }

  await run(
    `UPDATE "_package" SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1::uuid AND "deletedAt" IS NULL`,
    [IDS.package]
  );

  await run(
    `UPDATE person SET "deletedAt" = NOW(), "updatedAt" = NOW()
     WHERE id::text = ANY($1::text[]) AND "deletedAt" IS NULL`,
    [pids]
  );
}

export type DevTimTestQueueSeedResult =
  | { ok: true; alreadySeeded: true; message: string }
  | {
      ok: true;
      alreadySeeded?: false;
      giWorkflowId: string;
      warmWorkflowId: string;
      warmItemId: string;
      message: string;
    }
  | { ok: false; error: string };

/**
 * Inserts 2 general-inbox + 1 warm MESSAGE_DRAFT rows when Postgres CRM is available.
 */
export async function runDevTimTestQueueSeed(opts: { force?: boolean }): Promise<DevTimTestQueueSeedResult> {
  if (!process.env.CRM_DB_PASSWORD?.trim()) {
    return {
      ok: false,
      error:
        "CRM_DB_PASSWORD is not set (dev-store mode or missing env). Configure Postgres in web/.env.local.",
    };
  }

  const existing = await query<{ x: number }>(
    `SELECT 1 AS x FROM person WHERE id = $1::uuid AND "deletedAt" IS NULL LIMIT 1`,
    [IDS.personGi1]
  );
  if (existing.length > 0 && !opts.force) {
    return {
      ok: true,
      alreadySeeded: true,
      message:
        "Sample rows already exist. Use “Replace sample” to soft-delete and re-insert, or dismiss this bar.",
    };
  }

  const warmTmpl = WORKFLOW_TYPES["warm-outreach"];
  const giWorkflowId = await ensureGeneralLinkedInInboxWorkflowId();

  try {
    const out = await transaction(async (runQuery) => {
      const run: RunRows = async (sql, params) => {
        const r = await runQuery(sql, params);
        return r.rows;
      };

      if (opts.force) {
        await softDeleteSeed(run);
      }

      await run(
        `INSERT INTO person (id, "nameFirstName", "nameLastName", "jobTitle", "createdAt", "updatedAt")
         VALUES
           ($1, 'Queue', 'Test Inbox 1', 'Dev seed — Tim general inbox', NOW(), NOW()),
           ($2, 'Queue', 'Test Inbox 2', 'Dev seed — Tim general inbox', NOW(), NOW()),
           ($3, 'Queue', 'Test Warm', 'Dev seed — Tim MESSAGE_DRAFT', NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           "deletedAt" = NULL,
           "nameFirstName" = EXCLUDED."nameFirstName",
           "nameLastName" = EXCLUDED."nameLastName",
           "jobTitle" = EXCLUDED."jobTitle",
           "updatedAt" = NOW()`,
        [IDS.personGi1, IDS.personGi2, IDS.personWarm]
      );

      const header =
        "## LinkedIn — inbound message (general inbox)\n\n**From:** Dev seed\n\nHello from the test queue.";
      for (const pid of [IDS.personGi1, IDS.personGi2]) {
        const open = await run(
          `SELECT wi.id FROM "_workflow_item" wi
           WHERE wi."workflowId" = $1::uuid AND wi."sourceType" = 'person' AND wi."sourceId" = $2::uuid
             AND UPPER(TRIM(wi.stage::text)) = 'LINKEDIN_INBOUND' AND wi."deletedAt" IS NULL
           LIMIT 1`,
          [giWorkflowId, pid]
        );
        let itemId: string;
        if (open.length > 0 && open[0].id) {
          itemId = String(open[0].id);
        } else {
          const ins = await run(
            `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "position", "createdAt", "updatedAt", "humanTaskOpen")
             VALUES ($1::uuid, 'LINKEDIN_INBOUND', 'person', $2::uuid, 0, NOW(), NOW(), true)
             RETURNING id`,
            [giWorkflowId, pid]
          );
          itemId = String(ins[0]!.id);
        }
        const art = await run(
          `SELECT 1 AS x FROM "_artifact" WHERE "workflowItemId" = $1::uuid AND name = 'Dev seed: inbound' AND "deletedAt" IS NULL LIMIT 1`,
          [itemId]
        );
        if (art.length === 0) {
          await run(
            `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
             VALUES ($1::uuid, $2::uuid, 'LINKEDIN_INBOUND', $3, 'markdown', $4, NOW(), NOW())`,
            [itemId, giWorkflowId, "Dev seed: inbound", header]
          );
        }
      }

      const pkgSpec = {
        templateId: "vibe-coding-outreach",
        deliverables: [
          {
            workflowType: "warm-outreach",
            ownerAgent: "tim",
            targetCount: 5,
            label: "Warm Outreach",
            volumeLabel: "Five messages per day",
          },
        ],
      };

      await run(
        `INSERT INTO "_package" (id, "templateId", name, "customerId", "customerType", spec, stage, "createdBy", "createdAt", "updatedAt")
         VALUES ($1::uuid, 'vibe-coding-outreach', $2, NULL, 'person', $3::jsonb, 'ACTIVE', 'penny', NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           spec = EXCLUDED.spec,
           stage = 'ACTIVE',
           "deletedAt" = NULL,
           "updatedAt" = NOW()`,
        [IDS.package, PKG_NAME, JSON.stringify(pkgSpec)]
      );

      const boardR = await run(
        `INSERT INTO "_board" (name, description, stages, transitions, "createdAt", "updatedAt")
         VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW(), NOW()) RETURNING id`,
        [
          `${PKG_NAME} — Warm Outreach`,
          warmTmpl.description,
          JSON.stringify(warmTmpl.defaultBoard.stages),
          JSON.stringify(warmTmpl.defaultBoard.transitions),
        ]
      );
      const warmBoardId = String(boardR[0]!.id);

      const wfR = await run(
        `INSERT INTO "_workflow" (name, spec, "itemType", "boardId", "ownerAgent", "packageId", stage, "createdAt", "updatedAt")
         VALUES ($1, $2::jsonb, $3, $4::uuid, 'tim', $5::uuid, 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [
          "Warm Outreach",
          JSON.stringify({
            targetCount: 5,
            workflowType: "warm-outreach",
            pacing: null,
          }),
          warmTmpl.itemType,
          warmBoardId,
          IDS.package,
        ]
      );
      const warmWfId = String(wfR[0]!.id);

      const wiR = await run(
        `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt", "humanTaskOpen", "dueDate")
         VALUES ($1::uuid, 'MESSAGE_DRAFT', 'person', $2::uuid, NOW(), NOW(), true, NULL)
         RETURNING id`,
        [warmWfId, IDS.personWarm]
      );
      const warmItemId = String(wiR[0]!.id);

      await run(
        `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
         VALUES ($1::uuid, $2::uuid, 'MESSAGE_DRAFT', 'Dev seed draft', 'markdown', $3, NOW(), NOW())`,
        [
          warmItemId,
          warmWfId,
          "# Message draft (dev seed)\n\nHi Queue — this is a **fake** warm outreach draft for UI testing.\n\n— Tim seed",
        ]
      );

      return { giWorkflowId, warmWfId, warmItemId };
    });

    return {
      ok: true,
      giWorkflowId: out.giWorkflowId,
      warmWorkflowId: out.warmWfId,
      warmItemId: out.warmItemId,
      message: "Added 3 sample messaging rows (2 LinkedIn inbox + 1 warm draft).",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
