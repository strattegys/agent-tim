/**
 * Scout campaign queue — types and helpers for /api/crm/scout-queue and Command Central UI.
 */

import type {
  PackageDeliverable,
  PackageSpec,
  ScoutSourceRef,
  ScoutTargetingSpec,
} from "@/lib/package-types";

export type { ScoutSourceRef, ScoutTargetingSpec };

export type ScoutQueuePackageStage = "ACTIVE" | "PAUSED" | string;

export interface ScoutQueueCampaign {
  packageId: string;
  packageName: string;
  packageStage: ScoutQueuePackageStage;
  workflowId: string;
  workflowName: string;
  targetCount: number;
  volumeLabel: string | null;
  deliverableLabel: string | null;
  pacing: { batchSize: number; interval: string; bufferPercent?: number } | null;
  impliedDailyGoal: number;
  configuredDailyGoal: number | null;
  effectiveDailyGoal: number;
  scoutTargeting: ScoutTargetingSpec | null;
  stageCounts: Record<string, number>;
  totalItems: number;
  handedOffCount: number;
  rejectedCount: number;
  inPipelineCount: number;
  itemsCreatedLast24h: number;
  progressPercent: number;
}

export interface ScoutQueueSummary {
  campaignCount: number;
  totalEffectiveDailyGoal: number;
  totalHandedOff: number;
  totalInPipeline: number;
  totalItemsCreatedLast24h: number;
}

export interface ScoutQueueResponse {
  campaigns: ScoutQueueCampaign[];
  summary: ScoutQueueSummary;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** Parse `spec.scoutTargeting` from package JSON. */
export function parseScoutTargeting(raw: unknown): ScoutTargetingSpec | null {
  if (!isRecord(raw)) return null;
  const o = raw.scoutTargeting;
  if (!isRecord(o)) return null;
  const out: ScoutTargetingSpec = {};
  if (typeof o.dailyNewTargetsGoal === "number" && o.dailyNewTargetsGoal >= 0) {
    out.dailyNewTargetsGoal = o.dailyNewTargetsGoal;
  }
  if (typeof o.icpSummary === "string" && o.icpSummary.trim()) out.icpSummary = o.icpSummary.trim();
  if (typeof o.notes === "string" && o.notes.trim()) out.notes = o.notes.trim();
  if (Array.isArray(o.titlePatterns)) {
    out.titlePatterns = o.titlePatterns.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  }
  if (Array.isArray(o.keywords)) {
    out.keywords = o.keywords.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  }
  if (Array.isArray(o.excludeKeywords)) {
    out.excludeKeywords = o.excludeKeywords.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  }
  if (Array.isArray(o.sources)) {
    out.sources = o.sources
      .filter(isRecord)
      .map((s) => {
        const type = typeof s.type === "string" ? s.type.trim() : "";
        if (!type) return null;
        const ref: ScoutSourceRef = { type };
        if (typeof s.label === "string" && s.label.trim()) ref.label = s.label.trim();
        if (typeof s.detail === "string" && s.detail.trim()) ref.detail = s.detail.trim();
        return ref;
      })
      .filter((x): x is ScoutSourceRef => x != null);
  }
  if (
    out.dailyNewTargetsGoal == null &&
    !out.icpSummary &&
    !out.notes &&
    !out.titlePatterns?.length &&
    !out.keywords?.length &&
    !out.excludeKeywords?.length &&
    !out.sources?.length
  ) {
    return null;
  }
  return out;
}

/** Batch size when interval is daily; else spread weekly/biweekly into per-day average. */
export function impliedDailyFromPacing(d: PackageDeliverable | null | undefined): number {
  if (!d?.pacing) return 0;
  const { batchSize, interval } = d.pacing;
  if (typeof batchSize !== "number" || batchSize <= 0) return 0;
  if (interval === "daily") return Math.round(batchSize);
  if (interval === "weekly") return Math.max(1, Math.round(batchSize / 7));
  if (interval === "biweekly") return Math.max(1, Math.round(batchSize / 14));
  return 0;
}

/**
 * When pacing is missing, spread remaining target across default horizon (e.g. 10 business days).
 */
export function impliedDailyFromTargetCount(targetCount: number, handedOff: number, defaultDays = 10): number {
  const left = Math.max(0, targetCount - handedOff);
  if (left <= 0) return 0;
  return Math.max(1, Math.ceil(left / defaultDays));
}

export function resolveDeliverableForScoutWorkflow(
  packageSpecRaw: unknown,
  workflowType: string
): PackageDeliverable | null {
  let spec: PackageSpec | null = null;
  if (typeof packageSpecRaw === "string") {
    try {
      spec = JSON.parse(packageSpecRaw) as PackageSpec;
    } catch {
      return null;
    }
  } else if (packageSpecRaw && typeof packageSpecRaw === "object") {
    spec = packageSpecRaw as PackageSpec;
  }
  if (!spec || !Array.isArray(spec.deliverables)) return null;
  const d = spec.deliverables.find(
    (x) => x && typeof x === "object" && String(x.workflowType) === workflowType
  );
  return d ?? null;
}
