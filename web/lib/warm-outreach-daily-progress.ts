/**
 * Govind-facing “pace” for warm outreach: contact intakes submitted today (Pacific)
 * vs sum of package warmOutreachDiscovery.discoveriesPerDay for active warm workflows.
 */

import { query } from "./db";
import {
  isWarmOutreachPacificBusinessHoursNow,
  mergeWarmOutreachDiscovery,
  pacificCalendarDateString,
  pacificMinutesSinceMidnight,
  queryWarmOutreachActiveRows,
  type WarmOutreachHeartbeatFinding,
} from "./warm-outreach-discovery";

/**
 * Distinct workflow items that got a substantive Human input artifact today (Pacific),
 * while the row was still in a contact-intake stage (discovery slot or idea).
 */
export async function countWarmOutreachIntakeSubmitsPacificDate(
  datePacific: string
): Promise<number> {
  const rows = await query<{ c: string | number }>(
    `SELECT COUNT(*)::int AS c
     FROM (
       SELECT DISTINCT a."workflowItemId"
       FROM "_artifact" a
       INNER JOIN "_workflow_item" wi ON wi.id = a."workflowItemId" AND wi."deletedAt" IS NULL
       INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
       WHERE a."deletedAt" IS NULL
         AND COALESCE(w.spec::text, '') LIKE '%"workflowType"%'
         AND COALESCE(w.spec::text, '') LIKE '%warm-outreach%'
         AND UPPER(TRIM(a.stage::text)) IN ('AWAITING_CONTACT', 'IDEA')
         AND a.name ILIKE 'Human input:%'
         AND LENGTH(TRIM(COALESCE(a.content, ''))) > 0
         AND to_char((a."createdAt" AT TIME ZONE 'America/Los_Angeles'), 'YYYY-MM-DD') = $1
     ) sub`,
    [datePacific]
  );
  const raw = rows[0]?.c;
  return typeof raw === "number" ? raw : parseInt(String(raw || "0"), 10) || 0;
}

export async function getWarmOutreachDailyProgressForTim(): Promise<{
  completed: number;
  target: number;
  datePacific: string;
  pacedDailyActive: boolean;
  /** ISO — earliest future nextEligibleSpawnAt among paced workflows (null if none / not paced) */
  nextDiscoveryOpensAt: string | null;
} | null> {
  const activeRows = await queryWarmOutreachActiveRows();
  if (activeRows.length === 0) return null;

  const seen = new Set<string>();
  let target = 0;
  let pacedDailyActive = false;
  for (const row of activeRows) {
    const key = row.packageId ?? `orphan:${row.workflowId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cfg = mergeWarmOutreachDiscovery(row.pkgSpec);
    target += cfg.discoveriesPerDay;
    if (cfg.pacedDaily) pacedDailyActive = true;
  }

  const datePacific = pacificCalendarDateString();
  const completed = await countWarmOutreachIntakeSubmitsPacificDate(datePacific);

  let nextDiscoveryOpensAt: string | null = null;
  let soonest = Infinity;
  const now = Date.now();
  for (const row of activeRows) {
    const cfg = mergeWarmOutreachDiscovery(row.pkgSpec);
    if (!cfg.pacedDaily) continue;
    const cad = (row.wfSpec.discoveryCadence || {}) as {
      day?: string;
      nextEligibleSpawnAt?: string;
    };
    if (cad.day !== datePacific || !cad.nextEligibleSpawnAt) continue;
    const t = Date.parse(cad.nextEligibleSpawnAt);
    if (!Number.isFinite(t) || t <= now) continue;
    if (t < soonest) soonest = t;
  }
  if (soonest !== Infinity) nextDiscoveryOpensAt = new Date(soonest).toISOString();

  return {
    completed,
    target: Math.max(0, target),
    datePacific,
    pacedDailyActive,
    nextDiscoveryOpensAt,
  };
}

/** After noon Pacific, during outreach business hours, nudge if under daily intake target. */
export async function checkWarmOutreachDailyPaceFindings(): Promise<WarmOutreachHeartbeatFinding[]> {
  if (!isWarmOutreachPacificBusinessHoursNow()) return [];

  const noonPt = 12 * 60;
  if (pacificMinutesSinceMidnight() < noonPt) return [];

  const prog = await getWarmOutreachDailyProgressForTim();
  if (!prog || prog.target <= 0) return [];
  if (prog.completed >= prog.target) return [];

  const behind = prog.target - prog.completed;
  const lateAfternoon = pacificMinutesSinceMidnight() >= 14 * 60;
  const priority: WarmOutreachHeartbeatFinding["priority"] =
    prog.completed === 0 && lateAfternoon ? "high" : "medium";

  return [
    {
      category: `warm-outreach-daily-pace-${prog.datePacific}`,
      title: `Warm outreach pace: ${prog.completed} / ${prog.target} contact intakes today (Pacific)`,
      detail: `Packages sum to ${prog.target} intake(s) per day (warmOutreachDiscovery.discoveriesPerDay). You are ${behind} short — open Tim’s work queue and submit contact notes for the next slot(s). Counts distinct contacts where you used Submit on AWAITING_CONTACT / IDEA today.`,
      priority,
    },
  ];
}
