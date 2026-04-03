/**
 * Package Template Registry
 *
 * Defines reusable service package templates. Each package bundles multiple
 * workflow deliverables across agents. When a package is approved, the system
 * auto-creates the corresponding workflows for each deliverable.
 *
 * **Catalog templates are turned off for now** — only `custom` (ad-hoc spec on the row)
 * and hidden **system** packages (LinkedIn inboxes) remain. Create packages with
 * `templateId: "custom"` and `spec.deliverables`; copy shape from an existing package if needed.
 */

export interface PackageDeliverable {
  /** References a key in WORKFLOW_TYPES */
  workflowType: string;
  /** Agent ID that owns this workflow */
  ownerAgent: string;
  /**
   * OUTPUT target — the number of items that should reach the final/handoff stage.
   * The agent may need to source more (e.g., 25 to get 20 through qualification).
   */
  targetCount: number;
  /** Human-readable label */
  label: string;
  /**
   * When set, package planner shows this instead of derived "N messages/items" (e.g. daily cadence).
   */
  volumeLabel?: string;
  /**
   * Pacing controls how items flow through the pipeline.
   * - batchSize: how many items to process per interval (default: all at once)
   * - interval: "daily" | "weekly" | "biweekly" — time between batches
   * - bufferPercent: extra items to source above targetCount to account for rejections (default: 25)
   */
  pacing?: {
    batchSize: number;
    interval: "daily" | "weekly" | "biweekly";
    /** Percentage above targetCount to source, accounting for rejections. Default 25%. */
    bufferPercent?: number;
  };
  /** Per-stage custom notes (stage key → note text). Overrides/supplements default instructions. */
  stageNotes?: Record<string, string>;
  /**
   * Cross-workflow dependency: this deliverable cannot start until the specified
   * deliverable (by index) reaches the specified stage.
   * Example: { deliverableIndex: 0, stage: "REVIEW" } means "wait until
   * deliverable #0 reaches REVIEW before this workflow can begin."
   */
  blockedBy?: {
    /** Index of the deliverable in the same package that must reach a stage first */
    deliverableIndex: number;
    /** The stage that must be reached (or passed) to unblock */
    stage: string;
    /** Human-readable explanation of why this dependency exists */
    reason: string;
  }[];
  /**
   * Stop sourcing new items when another deliverable hits a count threshold.
   * Items already in the pipeline continue to completion.
   * Example: Scout stops finding when Tim reaches 20 at MESSAGED.
   */
  stopWhen?: {
    /** Index of the deliverable whose stage count triggers the stop */
    deliverableIndex: number;
    /** The stage to count */
    stage: string;
    /** Stop when this many items reach that stage */
    count: number;
    /** Human-readable explanation */
    reason: string;
  };
}

/** Tim warm-outreach: timed "find someone on LinkedIn" slots (see lib/warm-outreach-discovery.ts). */
export interface WarmOutreachDiscoverySpec {
  discoveriesPerDay?: number;
  minIntervalMinutes?: number;
  backlogWarnThreshold?: number;
  paused?: boolean;
  /**
   * Weekdays (Pacific) only; first slot from `bootstrapStartMinutesPt` if none open; after each intake,
   * wait `postIntakeDelayMinMinutes`–`postIntakeDelayMaxMinutes` before the next spawn (cron-enforced).
   */
  pacedDaily?: boolean;
  /** Minutes since midnight PT (default 510 = 8:30) — first slot may appear from this time if queue empty */
  bootstrapStartMinutesPt?: number;
  postIntakeDelayMinMinutes?: number;
  postIntakeDelayMaxMinutes?: number;
  maxOpenDiscoverySlots?: number;
}

/** Structured targeting for Scout — stored on package `spec.scoutTargeting`. */
export interface ScoutSourceRef {
  /** e.g. unipile_people_search | unipile_followers_of | rss | event | web_search */
  type: string;
  label?: string;
  /** Freeform: URLs, influencer slug, search keywords, feed URL, etc. */
  detail?: string;
}

export interface ScoutTargetingSpec {
  /** Preferred daily count of new people entering the Scout pipeline (FINDING). */
  dailyNewTargetsGoal?: number;
  /** One-line ICP for cards and prompts. */
  icpSummary?: string;
  /** Longer notes for Scout / operators. */
  notes?: string;
  titlePatterns?: string[];
  keywords?: string[];
  excludeKeywords?: string[];
  sources?: ScoutSourceRef[];
}

/**
 * Shape of the spec JSONB stored in the _package table.
 * Contains the package brief and the deliverables array.
 */
export interface PackageSpec {
  /** Freeform context for the package — product info, messaging, target audience, tone. */
  brief?: string;
  /** Workflow deliverables that make up this package. */
  deliverables: PackageDeliverable[];
  /** Optional — warm-outreach template only; hourly job + heartbeat use this. */
  warmOutreachDiscovery?: WarmOutreachDiscoverySpec;
  /** Optional — Scout campaign queue + discovery prompts (see lib/scout-queue.ts). */
  scoutTargeting?: ScoutTargetingSpec;
}

export interface PackageTemplateSpec {
  /** Unique slug for this package type */
  id: string;
  /** Human-readable label */
  label: string;
  /** Description for humans */
  description: string;
  /** When true, hide from Penny / Friday template pickers (infrastructure packages). */
  hideFromPlanner?: boolean;
  /** Workflows that make up this package */
  deliverables: PackageDeliverable[];
  /**
   * When true, Penny package card shows an editable package brief (`spec.brief`) in the header
   * and seeds a PACKAGE_BRIEF artifact on each warm-outreach (etc.) item at activation/spawn.
   */
  showPackageBrief?: boolean;
}

export const PACKAGE_TEMPLATES: Record<string, PackageTemplateSpec> = {
  /**
   * Ad-hoc packages: deliverables and brief live in `spec` on the row.
   * POST /api/crm/packages with templateId `custom` and optional `spec.deliverables`.
   */
  custom: {
    id: "custom",
    label: "Custom package",
    description:
      "No catalog template — workflows are defined only on this package. Copy deliverables from another package or edit in planner.",
    hideFromPlanner: true,
    deliverables: [],
    showPackageBrief: true,
  },

  /** Tim — always-on LinkedIn message inbox (one workflow, same name as package). */
  "linkedin-general-inbox-package": {
    id: "linkedin-general-inbox-package",
    label: "LinkedIn — General Inbox (system)",
    description:
      "Infrastructure package for unmatched LinkedIn inbound events. Created automatically; do not duplicate from Planner.",
    hideFromPlanner: true,
    deliverables: [
      {
        workflowType: "linkedin-general-inbox",
        ownerAgent: "tim",
        targetCount: 0,
        label: "LinkedIn — General Inbox",
      },
    ],
  },

  /** Tim — connection acceptances without a packaged outreach row. */
  "linkedin-connection-intake-package": {
    id: "linkedin-connection-intake-package",
    label: "LinkedIn — Connection intake (system)",
    description:
      "Infrastructure package for non-package connection acceptances. Created automatically; do not duplicate from Planner.",
    hideFromPlanner: true,
    deliverables: [
      {
        workflowType: "linkedin-connection-intake",
        ownerAgent: "tim",
        targetCount: 0,
        label: "LinkedIn — Connection intake",
      },
    ],
  },
};

/** Look up a package template by ID. Returns undefined if not found (e.g. legacy rows with old template ids). */
export function getPackageTemplate(
  id: string
): PackageTemplateSpec | undefined {
  return PACKAGE_TEMPLATES[id];
}

/**
 * Catalog templates for Penny / Friday pickers — empty until you add real templates again.
 * System packages use `hideFromPlanner: true` and are not listed here.
 */
export const PLANNER_PACKAGE_TEMPLATES: PackageTemplateSpec[] = Object.values(
  PACKAGE_TEMPLATES
).filter((t) => !t.hideFromPlanner);

/** `templateId` values that must not be user-deleted (system / infrastructure packages). */
export const PACKAGE_DELETE_BLOCKED_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  "linkedin-general-inbox-package",
  "linkedin-connection-intake-package",
]);
