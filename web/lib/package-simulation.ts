/**
 * One-shot “day” simulation for package planner: opener intake + probabilistic reply / Reply-to-close outcomes.
 * Persons use `PACKAGE_SIMULATION_JOB_TITLE`; `POST /api/crm/packages/reset` soft-deletes them with that title.
 */
import { query } from "@/lib/db";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";
import { promoteReplyToCloseFromReplied } from "@/lib/reply-to-close-promote";
import { syncHumanTaskOpenForItem } from "@/lib/workflow-item-human-task";
import { PACKAGE_TEMPLATES } from "@/lib/package-types";
import type { WorkflowTypeSpec } from "@/lib/workflow-types";

export const PACKAGE_SIMULATION_JOB_TITLE = "Package simulation (CRM test)";

/** Seeded PRNG in [0, 1) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RTC_STAGES_TO_KIT: string[] = [
  "REPLY_SENT",
  "AWAITING_THEIR_REPLY",
  "FOLLOW_UP_ONE_DRAFT",
  "FOLLOW_UP_ONE_SENT",
  "AWAITING_AFTER_FOLLOW_UP_ONE",
  "FOLLOW_UP_TWO_DRAFT",
  "FOLLOW_UP_TWO_SENT",
  "AWAITING_AFTER_FOLLOW_UP_TWO",
  "KIT_ENROLLED",
];

export type PackageSimulateDayInput = {
  packageId: string;
  replyRate: number;
  replyToCloseConversionRate: number;
  seed: number;
};

export type PackageSimulateDayResult = {
  ok: true;
  seed: number;
  log: string[];
  summary: Record<string, Record<string, number>>;
  cohort: {
    intake: number;
    openerReplied: number;
    openerCompletedNoReply: number;
    rtcConverted: number;
    rtcNurtureClosed: number;
  };
};

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

type WfRow = {
  id: string;
  name: string;
  spec: string | { workflowType?: string; targetCount?: number };
};

function parseSpec(spec: WfRow["spec"]): { workflowType?: string; targetCount?: number } {
  return typeof spec === "string" ? JSON.parse(spec) : spec;
}

async function buildSummary(packageId: string): Promise<Record<string, Record<string, number>>> {
  const finalWorkflows = await query<WfRow>(
    `SELECT id, name, spec FROM "_workflow" WHERE "packageId" = $1 AND "deletedAt" IS NULL`,
    [packageId]
  );
  const summary: Record<string, Record<string, number>> = {};
  for (const wf of finalWorkflows) {
    const items = await query<{ stage: string }>(
      `SELECT stage FROM "_workflow_item" WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
      [wf.id]
    );
    const counts: Record<string, number> = {};
    for (const item of items) {
      const k = String(item.stage || "").trim();
      counts[k] = (counts[k] || 0) + 1;
    }
    summary[wf.name] = counts;
  }
  return summary;
}

export async function runPackageSimulateDay(
  input: PackageSimulateDayInput,
  wfReg: { get: (id: string) => WorkflowTypeSpec | undefined }
): Promise<PackageSimulateDayResult> {
  const { packageId } = input;
  const replyRate = clamp01(input.replyRate);
  const replyToCloseConversionRate = clamp01(input.replyToCloseConversionRate);
  const seed = (input.seed >>> 0) || 1;
  const rng = mulberry32(seed);

  const log: string[] = [];
  const cohort = {
    intake: 0,
    openerReplied: 0,
    openerCompletedNoReply: 0,
    rtcConverted: 0,
    rtcNurtureClosed: 0,
  };

  const pkgRows = await query<{ id: string; stage: string; spec: unknown; templateId: string }>(
    `SELECT id, stage, spec, "templateId" AS "templateId" FROM "_package" WHERE id = $1 AND "deletedAt" IS NULL`,
    [packageId]
  );
  if (pkgRows.length === 0) {
    throw new Error("Package not found");
  }
  const pkgStage = (pkgRows[0].stage || "").trim().toUpperCase();
  if (pkgStage !== "DRAFT" && pkgStage !== "PENDING_APPROVAL") {
    throw new Error("Simulate is only allowed for Draft or Testing (PENDING_APPROVAL) packages");
  }

  const rawSpec =
    typeof pkgRows[0].spec === "string" ? JSON.parse(pkgRows[0].spec) : pkgRows[0].spec;
  const specDeliverables = Array.isArray(rawSpec?.deliverables) ? rawSpec.deliverables : [];
  const rowTemplateId = String(pkgRows[0].templateId || "").trim();
  const tmpl =
    PACKAGE_TEMPLATES[String(rawSpec?.templateId || rowTemplateId || "")];
  const templateDeliverables = Array.isArray(tmpl?.deliverables) ? tmpl.deliverables : [];
  const deliverables =
    specDeliverables.length > 0 ? specDeliverables : templateDeliverables;

  const openerDel = deliverables.find(
    (d: { workflowType?: string }) => d.workflowType === "linkedin-opener-sequence"
  );
  const dailyIntake =
    typeof openerDel?.targetCount === "number" && openerDel.targetCount > 0
      ? Math.min(500, Math.floor(openerDel.targetCount))
      : 0;

  const workflows = await query<WfRow>(
    `SELECT id, name, spec FROM "_workflow" WHERE "packageId" = $1 AND "deletedAt" IS NULL`,
    [packageId]
  );

  const openerWf = workflows.find((w) => parseSpec(w.spec).workflowType === "linkedin-opener-sequence");
  const rtcWf = workflows.find((w) => parseSpec(w.spec).workflowType === "reply-to-close");

  if (!openerWf) {
    log.push("No linkedin-opener-sequence workflow on this package — nothing to simulate.");
    const summary = await buildSummary(packageId);
    notifyDashboardSyncChange();
    return { ok: true, seed, log, summary, cohort };
  }

  const openerType = wfReg.get("linkedin-opener-sequence");
  if (!openerType) {
    throw new Error("linkedin-opener-sequence type missing from registry");
  }

  const rtcType = rtcWf ? wfReg.get("reply-to-close") : undefined;
  if (rtcWf && !rtcType) {
    throw new Error("reply-to-close type missing from registry");
  }

  const runId = Date.now();
  for (let i = 0; i < dailyIntake; i++) {
    cohort.intake++;
    const first = `Sim${runId % 10000}`;
    const last = `T${i + 1}`;
    const pRows = await query<{ id: string }>(
      `INSERT INTO person ("nameFirstName", "nameLastName", "jobTitle", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING id`,
      [first, last, PACKAGE_SIMULATION_JOB_TITLE]
    );
    const personId = pRows[0]?.id as string;

    const wiRows = await query<{ id: string }>(
      `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
       VALUES ($1, 'DRAFT_MESSAGE', 'person', $2, NOW(), NOW())
       RETURNING id`,
      [openerWf.id, personId]
    );
    const openerItemId = wiRows[0]?.id as string;
    await syncHumanTaskOpenForItem(openerItemId);
    log.push(`Intake ${i + 1}/${dailyIntake}: person ${personId.slice(0, 8)}… → opener DRAFT_MESSAGE`);

    let sendCount = 0;
    let openerOutcome: "REPLIED" | "COMPLETED" = "COMPLETED";
    while (true) {
      await query(
        `UPDATE "_workflow_item" SET stage = 'SENT_MESSAGE', "updatedAt" = NOW() WHERE id = $1 AND "deletedAt" IS NULL`,
        [openerItemId]
      );
      await syncHumanTaskOpenForItem(openerItemId);
      sendCount++;
      log.push(`  → send ${sendCount}/3: SENT_MESSAGE`);

      if (rng() < replyRate) {
        await query(
          `UPDATE "_workflow_item" SET stage = 'REPLIED', "updatedAt" = NOW() WHERE id = $1 AND "deletedAt" IS NULL`,
          [openerItemId]
        );
        await syncHumanTaskOpenForItem(openerItemId);
        openerOutcome = "REPLIED";
        cohort.openerReplied++;
        log.push(`  → replied (p=${replyRate})`);
        break;
      }

      if (sendCount >= 3) {
        await query(
          `UPDATE "_workflow_item" SET stage = 'COMPLETED', "updatedAt" = NOW() WHERE id = $1 AND "deletedAt" IS NULL`,
          [openerItemId]
        );
        await syncHumanTaskOpenForItem(openerItemId);
        cohort.openerCompletedNoReply++;
        log.push(`  → no reply after 3 sends → COMPLETED`);
        break;
      }

      await query(
        `UPDATE "_workflow_item" SET stage = 'DRAFT_MESSAGE', "updatedAt" = NOW() WHERE id = $1 AND "deletedAt" IS NULL`,
        [openerItemId]
      );
      await syncHumanTaskOpenForItem(openerItemId);
      log.push(`  → no reply → DRAFT_MESSAGE (nudge ${sendCount + 1})`);
    }

    if (openerOutcome === "REPLIED" && rtcWf && rtcType) {
      const rtcRows = await query<{ id: string }>(
        `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
         VALUES ($1, 'REPLIED', 'person', $2, NOW(), NOW())
         RETURNING id`,
        [rtcWf.id, personId]
      );
      const rtcItemId = rtcRows[0]?.id as string;
      await syncHumanTaskOpenForItem(rtcItemId);
      log.push(`  → Reply-to-close item at REPLIED`);

      await promoteReplyToCloseFromReplied(rtcItemId, { skipNotify: true });

      if (rng() < replyToCloseConversionRate) {
        await query(
          `UPDATE "_workflow_item" SET stage = 'CONVERTED', "updatedAt" = NOW() WHERE id = $1 AND "deletedAt" IS NULL`,
          [rtcItemId]
        );
        await syncHumanTaskOpenForItem(rtcItemId);
        cohort.rtcConverted++;
        log.push(`  → RTC CONVERTED (p=${replyToCloseConversionRate})`);
      } else {
        for (const st of RTC_STAGES_TO_KIT) {
          await query(
            `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
            [st, rtcItemId]
          );
          await syncHumanTaskOpenForItem(rtcItemId);
        }
        cohort.rtcNurtureClosed++;
        log.push(`  → RTC full compressed path → KIT_ENROLLED`);
      }
    } else if (openerOutcome === "REPLIED" && !rtcWf) {
      log.push(`  (no reply-to-close workflow — opener stays REPLIED)`);
    }
  }

  if (dailyIntake === 0) {
    log.push(
      "Daily intake is 0 (set linkedin-opener-sequence deliverable targetCount > 0 for batch size)."
    );
  }

  const summary = await buildSummary(packageId);
  notifyDashboardSyncChange();
  return { ok: true, seed, log, summary, cohort };
}
