import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { ThroughputGoalStatus, WorkflowThroughputRow } from "@/lib/workflow-throughput-types";
import {
  workflowTypesWithThroughputGoals,
  type WorkflowThroughputGoalSpec,
  type WorkflowThroughputMetric,
} from "@/lib/workflow-types";

const DEFAULT_TZ = "America/New_York";

function classifyStatus(
  actual: number,
  target: number,
  elapsedRatio: number
): { status: ThroughputGoalStatus; minExpectedByNow: number } {
  if (target <= 0) {
    return { status: "on_track", minExpectedByNow: 0 };
  }
  if (actual >= target) {
    return { status: "met", minExpectedByNow: target };
  }
  const minExpectedByNow = Math.min(target, target * Math.max(0, Math.min(1, elapsedRatio)) * 0.85);
  if (elapsedRatio >= 0.98) {
    return { status: "at_risk", minExpectedByNow };
  }
  if (elapsedRatio < 0.08) {
    return { status: "on_track", minExpectedByNow };
  }
  if (actual < minExpectedByNow) {
    return { status: "behind", minExpectedByNow };
  }
  return { status: "on_track", minExpectedByNow };
}

/** Match workflow rows whether `spec` is jsonb or text JSON (Twenty / CRM). */
const WF_TYPE_SQL = `LOWER(TRIM(COALESCE(
  (w.spec::jsonb->>'workflowType'),
  (w.spec::jsonb->>'workflow_type'),
  ''
))) = LOWER(TRIM($2::text))`;

/**
 * Start of current calendar day in `tz`, as timestamptz, plus elapsed fraction [0,1] for that day.
 * Uses timezone(zone, timestamptz) so the zone name is always applied correctly with node-pg.
 */
const DAY_WINDOW_SQL = `
  WITH bounds AS (
    SELECT
      (date_trunc('day', timezone($1::text, now())) AT TIME ZONE $1::text) AS d0,
      (date_trunc('day', timezone($1::text, now())) AT TIME ZONE $1::text) + INTERVAL '1 day' AS d1
  )
  SELECT
    d0::text AS ws,
    d1::text AS we,
    LEAST(1::float, GREATEST(0::float,
      EXTRACT(EPOCH FROM (now() - d0)) / NULLIF(EXTRACT(EPOCH FROM INTERVAL '1 day'), 0)
    ))::text AS er
  FROM bounds`;

const WEEK_WINDOW_SQL = `
  WITH bounds AS (
    SELECT
      (date_trunc('week', timezone($1::text, now())) AT TIME ZONE $1::text) AS w0,
      (date_trunc('week', timezone($1::text, now())) AT TIME ZONE $1::text) + INTERVAL '7 days' AS w1
  )
  SELECT
    w0::text AS ws,
    w1::text AS we,
    LEAST(1::float, GREATEST(0::float,
      EXTRACT(EPOCH FROM (now() - w0)) / NULLIF(EXTRACT(EPOCH FROM INTERVAL '7 days'), 0)
    ))::text AS er
  FROM bounds`;

async function countMetric(
  metric: WorkflowThroughputMetric,
  workflowTypeId: string,
  tz: string
): Promise<{ actual: number; windowStart: string; windowEnd: string; elapsedRatio: number }> {
  if (metric === "warm_outreach_dm_sent") {
    const [countRow, winRow] = await Promise.all([
      query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "_artifact" a
         INNER JOIN "_workflow" w ON w.id = a."workflowId" AND w."deletedAt" IS NULL
         WHERE a."deletedAt" IS NULL
           AND ${WF_TYPE_SQL}
           AND UPPER(TRIM(a.stage)) = 'MESSAGED'
           AND TRIM(a.name) = 'LinkedIn DM sent'
           AND a."createdAt" >= (date_trunc('day', timezone($1::text, now())) AT TIME ZONE $1::text)
           AND a."createdAt" < (date_trunc('day', timezone($1::text, now())) AT TIME ZONE $1::text) + INTERVAL '1 day'`,
        [tz, workflowTypeId]
      ),
      query<{ ws: string; we: string; er: string }>(DAY_WINDOW_SQL, [tz]),
    ]);
    const w = winRow[0];
    return {
      actual: parseInt(countRow[0]?.c || "0", 10),
      windowStart: w?.ws ?? "",
      windowEnd: w?.we ?? "",
      elapsedRatio: parseFloat(w?.er || "0"),
    };
  }

  const [countRow, winRow] = await Promise.all([
    query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
       FROM "_artifact" a
       INNER JOIN "_workflow" w ON w.id = a."workflowId" AND w."deletedAt" IS NULL
       WHERE a."deletedAt" IS NULL
         AND ${WF_TYPE_SQL}
         AND UPPER(TRIM(a.stage)) = 'PUBLISHED'
         AND TRIM(a.name) = 'Published Article Record'
         AND a."createdAt" >= (date_trunc('week', timezone($1::text, now())) AT TIME ZONE $1::text)
         AND a."createdAt" < (date_trunc('week', timezone($1::text, now())) AT TIME ZONE $1::text) + INTERVAL '7 days'`,
      [tz, workflowTypeId]
    ),
    query<{ ws: string; we: string; er: string }>(WEEK_WINDOW_SQL, [tz]),
  ]);
  const w = winRow[0];
  return {
    actual: parseInt(countRow[0]?.c || "0", 10),
    windowStart: w?.ws ?? "",
    windowEnd: w?.we ?? "",
    elapsedRatio: parseFloat(w?.er || "0"),
  };
}

async function rowForGoal(
  id: string,
  label: string,
  g: WorkflowThroughputGoalSpec,
  tz: string
): Promise<WorkflowThroughputRow> {
  const { actual, windowStart, windowEnd, elapsedRatio } = await countMetric(g.metric, id, tz);
  const { status, minExpectedByNow } = classifyStatus(actual, g.target, elapsedRatio);
  return {
    workflowTypeId: id,
    workflowLabel: label,
    ownerLabel: g.ownerLabel,
    metricLabel: g.metricLabel,
    period: g.period,
    target: g.target,
    actual,
    windowStart,
    windowEnd,
    elapsedRatio,
    status,
    minExpectedByNow: Math.round(minExpectedByNow * 10) / 10,
  };
}

/**
 * GET /api/crm/workflow-throughput
 *
 * Friday Goals tab — actual counts vs targets from WORKFLOW_TYPES.throughputGoal.
 * Query: ?timezone=America/New_York (optional)
 */
export async function GET(req: NextRequest) {
  try {
    const tz = req.nextUrl.searchParams.get("timezone")?.trim() || DEFAULT_TZ;
    const defs = workflowTypesWithThroughputGoals();
    const items: WorkflowThroughputRow[] = [];
    for (const d of defs) {
      items.push(await rowForGoal(d.id, d.label, d.throughputGoal, tz));
    }
    return NextResponse.json({
      timezone: tz,
      items,
      note:
        "Counts use CRM artifacts: warm outreach = MESSAGED + name 'LinkedIn DM sent'; content = PUBLISHED + 'Published Article Record'.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[workflow-throughput] GET", msg, e);
    return NextResponse.json(
      {
        error: "Failed to load throughput",
        ...(process.env.NODE_ENV === "development" ? { detail: msg } : {}),
      },
      { status: 500 }
    );
  }
}
