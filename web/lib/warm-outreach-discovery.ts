/**
 * Warm outreach — timed "find someone on LinkedIn" slots (AWAITING_CONTACT).
 * Driven by package spec.warmOutreachDiscovery + hourly cron; ENDED still opens
 * one replacement when under backlog cap (does not consume daily cron quota).
 */

import { randomUUID } from "crypto";
import { query } from "./db";
import { insertPackageBriefArtifactIfPresent } from "./package-brief-artifact";
import {
  loadCustomWorkflowTypeMap,
  resolveWorkflowRegistryForQueueWithCustomMap,
} from "./workflow-registry";
import { syncHumanTaskOpenForItem } from "./workflow-item-human-task";
import { WARM_DISCOVERY_SOURCE_TYPE } from "./warm-discovery-item";

/** Pacific wall clock for outreach cadence (cron uses same zone). */
export const WARM_OUTREACH_PACIFIC_TZ = "America/Los_Angeles";

export function pacificMinutesSinceMidnight(d = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: WARM_OUTREACH_PACIFIC_TZ,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(d);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  return hour * 60 + minute;
}

/**
 * Inclusive window 8:30 AM – 4:30 PM Pacific (same as user-facing “working hours” for discovery ticks).
 */
export function isWarmOutreachPacificBusinessHoursNow(d = new Date()): boolean {
  const m = pacificMinutesSinceMidnight(d);
  const start = 8 * 60 + 30;
  const end = 16 * 60 + 30;
  return m >= start && m <= end;
}

export function pacificCalendarDateString(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: WARM_OUTREACH_PACIFIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Monday–Friday on the Pacific calendar (for paced discovery spawns). */
export function isPacificWeekday(d = new Date()): boolean {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: WARM_OUTREACH_PACIFIC_TZ,
    weekday: "short",
  }).format(d);
  return wd !== "Sat" && wd !== "Sun";
}

export const DEFAULT_WARM_OUTREACH_DISCOVERY = {
  /** Max extra discovery slots the hourly job may add per UTC calendar day */
  discoveriesPerDay: 5,
  /** Minimum time between new discovery slots (minutes) */
  minIntervalMinutes: 60,
  /** At or above this count of AWAITING_CONTACT items: no cron spawn, heartbeat nags */
  backlogWarnThreshold: 10,
  /** When true, hourly job skips spawning (ENDED replacement still respects backlog only) */
  paused: false,
  /**
   * When true: **weekdays only** (Pacific); first discovery slot from `bootstrapStartMinutesPt` (default 8:30)
   * if none are open; only `maxOpenDiscoverySlots` open AWAITING_CONTACT rows (default 1); after each intake
   * submit, cron waits until `nextEligibleSpawnAt` (randomized postIntake delay) before spawning the next slot.
   * Does not rely on the LLM — the resolve handler sets the timestamp; cron enforces it.
   */
  pacedDaily: false,
  /** First moment (PT, minutes since midnight) the paced job may add the **first** slot if none exist */
  bootstrapStartMinutesPt: 8 * 60 + 30,
  /** Random delay after intake submit before the next discovery slot may spawn (minutes, inclusive range) */
  postIntakeDelayMinMinutes: 30,
  postIntakeDelayMaxMinutes: 40,
  /** In paced mode: spawn only if fewer than this many AWAITING_CONTACT items exist */
  maxOpenDiscoverySlots: 1,
} as const;

export type WarmOutreachDiscoveryConfig = {
  discoveriesPerDay: number;
  minIntervalMinutes: number;
  backlogWarnThreshold: number;
  paused: boolean;
  pacedDaily: boolean;
  bootstrapStartMinutesPt: number;
  postIntakeDelayMinMinutes: number;
  postIntakeDelayMaxMinutes: number;
  maxOpenDiscoverySlots: number;
};

export interface WarmOutreachHeartbeatFinding {
  category: string;
  title: string;
  detail: string;
  priority: "critical" | "high" | "medium" | "low";
}

export type DiscoveryCadenceState = {
  day: string;
  count: number;
  lastSpawnAt: string;
  /** Paced mode: wall-clock earliest instant the cron may spawn the next discovery slot */
  nextEligibleSpawnAt?: string;
};

function parseJsonObject(spec: unknown): Record<string, unknown> {
  try {
    return typeof spec === "string" ? JSON.parse(spec) : (spec as Record<string, unknown>) || {};
  } catch {
    return {};
  }
}

export function mergeWarmOutreachDiscovery(pkgSpec: unknown): WarmOutreachDiscoveryConfig {
  const root = parseJsonObject(pkgSpec);
  const raw = root.warmOutreachDiscovery as Partial<WarmOutreachDiscoveryConfig> | undefined;
  const base: WarmOutreachDiscoveryConfig = {
    discoveriesPerDay: clampInt(raw?.discoveriesPerDay, DEFAULT_WARM_OUTREACH_DISCOVERY.discoveriesPerDay, 0, 24),
    minIntervalMinutes: clampInt(
      raw?.minIntervalMinutes,
      DEFAULT_WARM_OUTREACH_DISCOVERY.minIntervalMinutes,
      15,
      24 * 60
    ),
    backlogWarnThreshold: clampInt(
      raw?.backlogWarnThreshold,
      DEFAULT_WARM_OUTREACH_DISCOVERY.backlogWarnThreshold,
      1,
      500
    ),
    paused: Boolean(raw?.paused),
    pacedDaily: Boolean(raw?.pacedDaily),
    bootstrapStartMinutesPt: clampInt(
      raw?.bootstrapStartMinutesPt,
      DEFAULT_WARM_OUTREACH_DISCOVERY.bootstrapStartMinutesPt,
      0,
      24 * 60 - 1
    ),
    postIntakeDelayMinMinutes: DEFAULT_WARM_OUTREACH_DISCOVERY.postIntakeDelayMinMinutes,
    postIntakeDelayMaxMinutes: DEFAULT_WARM_OUTREACH_DISCOVERY.postIntakeDelayMaxMinutes,
    maxOpenDiscoverySlots: clampInt(
      raw?.maxOpenDiscoverySlots,
      DEFAULT_WARM_OUTREACH_DISCOVERY.maxOpenDiscoverySlots,
      1,
      50
    ),
  };
  let postMin = clampInt(
    raw?.postIntakeDelayMinMinutes,
    DEFAULT_WARM_OUTREACH_DISCOVERY.postIntakeDelayMinMinutes,
    5,
    24 * 60
  );
  let postMax = clampInt(
    raw?.postIntakeDelayMaxMinutes,
    DEFAULT_WARM_OUTREACH_DISCOVERY.postIntakeDelayMaxMinutes,
    5,
    24 * 60
  );
  if (postMin > postMax) {
    const swap = postMin;
    postMin = postMax;
    postMax = swap;
  }
  return {
    ...base,
    postIntakeDelayMinMinutes: postMin,
    postIntakeDelayMaxMinutes: postMax,
  };
}

function clampInt(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export async function countAwaitingContact(workflowId: string): Promise<number> {
  const r = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM "_workflow_item"
     WHERE "workflowId" = $1 AND stage = 'AWAITING_CONTACT' AND "deletedAt" IS NULL`,
    [workflowId]
  );
  return parseInt(r[0]?.c || "0", 10);
}

async function countTotalItems(workflowId: string): Promise<number> {
  const r = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM "_workflow_item"
     WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
    [workflowId]
  );
  return parseInt(r[0]?.c || "0", 10);
}

async function lastDiscoveryActivityMs(workflowId: string, wfSpec: Record<string, unknown>): Promise<number> {
  const cad = wfSpec.discoveryCadence as Partial<DiscoveryCadenceState> | undefined;
  if (cad?.lastSpawnAt) {
    const t = Date.parse(cad.lastSpawnAt);
    if (Number.isFinite(t)) return t;
  }
  const r = await query<{ t: string | null }>(
    `SELECT MAX("createdAt")::text AS t FROM "_workflow_item"
     WHERE "workflowId" = $1 AND stage = 'AWAITING_CONTACT' AND "deletedAt" IS NULL`,
    [workflowId]
  );
  const t = r[0]?.t;
  return t ? Date.parse(t) : 0;
}

async function updateWorkflowDiscoveryCadence(
  workflowId: string,
  wfSpec: Record<string, unknown>,
  next: DiscoveryCadenceState
): Promise<void> {
  const nextSpec = { ...wfSpec, discoveryCadence: next };
  await query(
    `UPDATE "_workflow" SET spec = $1::jsonb, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
    [JSON.stringify(nextSpec), workflowId]
  );
}

/**
 * Insert an AWAITING_CONTACT slot **without** a CRM `person` row.
 * `sourceType` = warm_discovery; `sourceId` is an opaque UUID until intake links a real contact.
 */
export async function insertWarmOutreachDiscoveryItem(
  workflowId: string,
  packageId: string | null
): Promise<string | null> {
  const slotId = randomUUID();

  const ins = await query<{ id: string }>(
    `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
     VALUES ($1, 'AWAITING_CONTACT', $2, $3, NOW(), NOW())
     RETURNING id`,
    [workflowId, WARM_DISCOVERY_SOURCE_TYPE, slotId]
  );
  const itemId = ins[0]?.id ?? null;
  if (!itemId) return null;

  await insertPackageBriefArtifactIfPresent(itemId, workflowId, packageId);
  await syncHumanTaskOpenForItem(itemId);
  return itemId;
}

export type WarmOutreachActiveRow = {
  workflowId: string;
  packageId: string | null;
  packageNumber: number | null;
  packageName: string;
  wfSpec: Record<string, unknown>;
  pkgSpec: Record<string, unknown>;
};

export async function queryWarmOutreachActiveRows(): Promise<WarmOutreachActiveRow[]> {
  const rows = await query<{
    workflow_id: string;
    packageId: string | null;
    packageNumber: string | number | null;
    packageName: string;
    wf_spec: unknown;
    pkg_spec: unknown;
    ownerAgent: string | null;
    board_stages: unknown;
  }>(
    `SELECT w.id AS workflow_id,
            w."packageId" AS "packageId",
            p."packageNumber" AS "packageNumber",
            p.name AS "packageName",
            w.spec AS wf_spec,
            p.spec AS pkg_spec,
            w."ownerAgent" AS "ownerAgent",
            b.stages AS board_stages
     FROM "_workflow" w
     INNER JOIN "_package" p ON p.id = w."packageId" AND p."deletedAt" IS NULL
     LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
     WHERE w."deletedAt" IS NULL
       AND UPPER(w.stage::text) = 'ACTIVE'
       AND UPPER(p.stage::text) = 'ACTIVE'`
  );

  const customMap = await loadCustomWorkflowTypeMap();
  return rows
    .filter(
      (r) =>
        resolveWorkflowRegistryForQueueWithCustomMap(
          r.wf_spec,
          {
            packageSpec: r.pkg_spec,
            ownerAgent: r.ownerAgent,
            boardStages: r.board_stages,
          },
          customMap
        ) === "warm-outreach"
    )
    .map((r) => ({
      workflowId: r.workflow_id,
      packageId: r.packageId,
      packageNumber:
        r.packageNumber != null && r.packageNumber !== ""
          ? typeof r.packageNumber === "number"
            ? r.packageNumber
            : parseInt(String(r.packageNumber), 10)
          : null,
      packageName: r.packageName || "",
      wfSpec: parseJsonObject(r.wf_spec),
      pkgSpec: parseJsonObject(r.pkg_spec),
    }));
}

/**
 * After a contact hits ENDED: one replacement slot if under caps (ignores daily cron quota).
 */
export async function spawnAfterWarmOutreachEnded(
  workflowId: string,
  targetCount: number
): Promise<string | null> {
  const wfRows = await query<{ packageId: string | null; spec: unknown }>(
    `SELECT "packageId", spec FROM "_workflow" WHERE id = $1 AND "deletedAt" IS NULL`,
    [workflowId]
  );
  if (wfRows.length === 0) return null;
  const packageId = wfRows[0].packageId;
  const wfSpec = parseJsonObject(wfRows[0].spec);

  let pkgSpec: Record<string, unknown> = {};
  if (packageId) {
    const p = await query<{ spec: unknown }>(
      `SELECT spec FROM "_package" WHERE id = $1 AND "deletedAt" IS NULL`,
      [packageId]
    );
    if (p[0]) pkgSpec = parseJsonObject(p[0].spec);
  }
  const cfg = mergeWarmOutreachDiscovery(pkgSpec);

  const total = await countTotalItems(workflowId);
  if (total >= targetCount) return null;

  const awaiting = await countAwaitingContact(workflowId);
  if (awaiting >= cfg.backlogWarnThreshold) return null;

  const itemId = await insertWarmOutreachDiscoveryItem(workflowId, packageId);
  if (!itemId) return null;

  if (cfg.pacedDaily) {
    const cadence = (wfSpec.discoveryCadence || {}) as Partial<DiscoveryCadenceState>;
    const day = pacificCalendarDateString();
    const countToday = cadence.day === day ? (typeof cadence.count === "number" ? cadence.count : 0) : 0;
    await updateWorkflowDiscoveryCadence(workflowId, wfSpec, {
      day,
      count: countToday + 1,
      lastSpawnAt: new Date().toISOString(),
    });
  }

  return itemId;
}

/**
 * Paced weekdays: first slot from bootstrap time (default 8:30 PT) if none open; later slots only after
 * `nextEligibleSpawnAt` (set when Govind submits intake). At most `maxOpenDiscoverySlots` AWAITING rows.
 */
async function trySpawnWarmOutreachPaced(
  row: WarmOutreachActiveRow,
  cfg: WarmOutreachDiscoveryConfig,
  wfSpec: Record<string, unknown>
): Promise<{ spawned: boolean; reason?: string }> {
  if (!isPacificWeekday()) return { spawned: false, reason: "weekend" };

  const awaiting = await countAwaitingContact(row.workflowId);
  if (awaiting >= cfg.maxOpenDiscoverySlots) {
    return { spawned: false, reason: "open_discovery_slot" };
  }

  const cadence = (wfSpec.discoveryCadence || {}) as Partial<DiscoveryCadenceState>;
  const day = pacificCalendarDateString();
  const countToday = cadence.day === day ? (typeof cadence.count === "number" ? cadence.count : 0) : 0;

  if (countToday >= cfg.discoveriesPerDay) return { spawned: false, reason: "daily_cap" };

  const m = pacificMinutesSinceMidnight();
  let allowSpawn = false;

  if (countToday === 0) {
    if (m >= cfg.bootstrapStartMinutesPt) allowSpawn = true;
  } else {
    const nel =
      cadence.day === day && typeof cadence.nextEligibleSpawnAt === "string"
        ? cadence.nextEligibleSpawnAt
        : undefined;
    const t = nel ? Date.parse(nel) : NaN;
    if (!Number.isFinite(t)) {
      allowSpawn = true;
    } else {
      allowSpawn = Date.now() >= t;
    }
  }

  if (!allowSpawn) return { spawned: false, reason: "paced_wait" };

  const itemId = await insertWarmOutreachDiscoveryItem(row.workflowId, row.packageId);
  if (!itemId) return { spawned: false, reason: "insert_failed" };

  await updateWorkflowDiscoveryCadence(row.workflowId, wfSpec, {
    day,
    count: countToday + 1,
    lastSpawnAt: new Date().toISOString(),
  });

  return { spawned: true };
}

/**
 * Cron: add at most one slot per workflow. Legacy mode uses daily cap + min interval; paced mode uses
 * weekdays, bootstrap window, and post-intake `nextEligibleSpawnAt` (see `scheduleNextWarmDiscoveryAfterIntake`).
 */
export async function trySpawnWarmOutreachDiscoveryCron(row: WarmOutreachActiveRow): Promise<{
  spawned: boolean;
  reason?: string;
}> {
  const cfg = mergeWarmOutreachDiscovery(row.pkgSpec);
  if (cfg.paused) return { spawned: false, reason: "paused" };

  const wfSpec = row.wfSpec;
  const targetCount = typeof wfSpec.targetCount === "number" ? wfSpec.targetCount : 10;

  const awaiting = await countAwaitingContact(row.workflowId);
  if (awaiting >= cfg.backlogWarnThreshold) return { spawned: false, reason: "backlog" };

  const total = await countTotalItems(row.workflowId);
  if (total >= targetCount) return { spawned: false, reason: "target_cap" };

  if (cfg.pacedDaily) {
    return trySpawnWarmOutreachPaced(row, cfg, wfSpec);
  }

  const cadence = (wfSpec.discoveryCadence || {}) as Partial<DiscoveryCadenceState>;
  const day = pacificCalendarDateString();
  const countToday = cadence.day === day ? (typeof cadence.count === "number" ? cadence.count : 0) : 0;
  if (countToday >= cfg.discoveriesPerDay) return { spawned: false, reason: "daily_cap" };

  const lastMs = await lastDiscoveryActivityMs(row.workflowId, wfSpec);
  if (lastMs > 0 && Date.now() - lastMs < cfg.minIntervalMinutes * 60 * 1000) {
    return { spawned: false, reason: "interval" };
  }

  const itemId = await insertWarmOutreachDiscoveryItem(row.workflowId, row.packageId);
  if (!itemId) return { spawned: false, reason: "insert_failed" };

  await updateWorkflowDiscoveryCadence(row.workflowId, wfSpec, {
    day,
    count: countToday + 1,
    lastSpawnAt: new Date().toISOString(),
  });

  return { spawned: true };
}

/**
 * After Govind submits warm-outreach contact intake, set the earliest time the cron may spawn the next slot.
 * No LLM involved — heartbeat can still remind, but pacing is enforced here.
 */
export async function scheduleNextWarmDiscoveryAfterIntake(workflowId: string): Promise<void> {
  const wfRows = await query<{ packageId: string | null; spec: unknown }>(
    `SELECT "packageId", spec FROM "_workflow" WHERE id = $1 AND "deletedAt" IS NULL`,
    [workflowId]
  );
  if (wfRows.length === 0) return;
  const packageId = wfRows[0].packageId;
  const wfSpec = parseJsonObject(wfRows[0].spec);
  if (String(wfSpec.workflowType || "") !== "warm-outreach") return;

  let pkgSpec: Record<string, unknown> = {};
  if (packageId) {
    const p = await query<{ spec: unknown }>(
      `SELECT spec FROM "_package" WHERE id = $1 AND "deletedAt" IS NULL`,
      [packageId]
    );
    if (p[0]) pkgSpec = parseJsonObject(p[0].spec);
  }
  const cfg = mergeWarmOutreachDiscovery(pkgSpec);
  if (!cfg.pacedDaily) return;

  const lo = cfg.postIntakeDelayMinMinutes;
  const hi = cfg.postIntakeDelayMaxMinutes;
  const span = Math.max(0, hi - lo);
  const mins = lo + (span > 0 ? Math.floor(Math.random() * (span + 1)) : 0);
  const when = new Date(Date.now() + mins * 60 * 1000);

  const cadence = (wfSpec.discoveryCadence || {}) as Partial<DiscoveryCadenceState>;
  const day = pacificCalendarDateString();
  const count = cadence.day === day && typeof cadence.count === "number" ? cadence.count : 0;
  const lastSpawnAt =
    typeof cadence.lastSpawnAt === "string" && cadence.lastSpawnAt
      ? cadence.lastSpawnAt
      : new Date().toISOString();

  await updateWorkflowDiscoveryCadence(workflowId, wfSpec, {
    day,
    count,
    lastSpawnAt,
    nextEligibleSpawnAt: when.toISOString(),
  });
}

export async function runWarmOutreachDiscoveryTick(): Promise<{ spawned: number; skipped: number }> {
  try {
    const { advanceWarmOutreachMessagedFollowupsPastDue } = await import("./warm-outreach-followup-due");
    const advanced = await advanceWarmOutreachMessagedFollowupsPastDue();
    if (advanced > 0) {
      console.log(
        `[warm-outreach-discovery] auto-advanced ${advanced} warm-outreach item(s) MESSAGED → MESSAGE_DRAFT (follow-up due)`
      );
    }
  } catch (e) {
    console.warn("[warm-outreach-discovery] follow-up due advance:", e);
  }

  try {
    if (!isWarmOutreachPacificBusinessHoursNow()) {
      return { spawned: 0, skipped: 0 };
    }

    const rows = await queryWarmOutreachActiveRows();
    let spawned = 0;
    let skipped = 0;
    for (const row of rows) {
      const r = await trySpawnWarmOutreachDiscoveryCron(row);
      if (r.spawned) spawned++;
      else skipped++;
    }
    if (spawned > 0) {
      console.log(
        `[warm-outreach-discovery] spawned ${spawned} discovery slot(s) across ${rows.length} workflow(s)`
      );
    }
    return { spawned, skipped };
  } catch (error) {
    console.error("[warm-outreach-discovery] tick failed:", error);
    return { spawned: 0, skipped: 0 };
  }
}

export async function checkWarmOutreachBacklogFindings(): Promise<WarmOutreachHeartbeatFinding[]> {
  const rows = await queryWarmOutreachActiveRows();
  const findings: WarmOutreachHeartbeatFinding[] = [];
  for (const row of rows) {
    const cfg = mergeWarmOutreachDiscovery(row.pkgSpec);
    const n = await countAwaitingContact(row.workflowId);
    if (n >= cfg.backlogWarnThreshold) {
      const num = row.packageNumber != null && !Number.isNaN(row.packageNumber) ? row.packageNumber : "?";
      findings.push({
        category: `warm-outreach-backlog-${num}`,
        title: `Warm outreach package #${num}: ${n} find-contact tasks backed up`,
        detail:
          `Package "${row.packageName}" has ${n} open "Next contact" slots (threshold ${cfg.backlogWarnThreshold}). ` +
          `Catch up on LinkedIn discovery. To pause auto-added slots, PATCH the package with ` +
          `spec.warmOutreachDiscovery.paused=true. To allow a larger queue, raise backlogWarnThreshold.`,
        priority: "high",
      });
    }
  }
  return findings;
}

/**
 * Ops: insert one AWAITING_CONTACT slot for an active warm-outreach workflow. Honors target_cap, backlog
 * threshold, and paced `maxOpenDiscoverySlots`. Does not bypass Pacific weekday/hours (use
 * `runWarmOutreachDiscoveryTick` for normal cron behavior).
 */
export async function forceInsertWarmOutreachDiscoverySlot(
  workflowId: string,
  opts?: { ignorePacedOpenCap?: boolean }
): Promise<{
  ok: boolean;
  itemId?: string;
  error?: string;
}> {
  const rows = await queryWarmOutreachActiveRows();
  const row = rows.find((r) => r.workflowId === workflowId);
  if (!row) {
    return { ok: false, error: "workflow_not_found_or_not_active_warm_outreach" };
  }

  const cfg = mergeWarmOutreachDiscovery(row.pkgSpec);
  const wfSpec = row.wfSpec;
  const targetCount = typeof wfSpec.targetCount === "number" ? wfSpec.targetCount : 10;
  const total = await countTotalItems(workflowId);
  if (total >= targetCount) return { ok: false, error: "target_cap" };

  const awaiting = await countAwaitingContact(workflowId);
  if (awaiting >= cfg.backlogWarnThreshold) return { ok: false, error: "backlog" };
  if (
    cfg.pacedDaily &&
    awaiting >= cfg.maxOpenDiscoverySlots &&
    !opts?.ignorePacedOpenCap
  ) {
    return { ok: false, error: "open_discovery_slot" };
  }

  const itemId = await insertWarmOutreachDiscoveryItem(workflowId, row.packageId);
  if (!itemId) return { ok: false, error: "insert_failed" };

  const cadence = (wfSpec.discoveryCadence || {}) as Partial<DiscoveryCadenceState>;
  const day = pacificCalendarDateString();
  const countToday = cadence.day === day ? (typeof cadence.count === "number" ? cadence.count : 0) : 0;
  await updateWorkflowDiscoveryCadence(workflowId, wfSpec, {
    day,
    count: countToday + 1,
    lastSpawnAt: new Date().toISOString(),
  });

  return { ok: true, itemId };
}
