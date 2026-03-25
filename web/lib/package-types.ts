/**
 * Package Template Registry
 *
 * Defines reusable service package templates. Each package bundles multiple
 * workflow deliverables across agents. When a package is approved, the system
 * auto-creates the corresponding workflows for each deliverable.
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

/**
 * Shape of the spec JSONB stored in the _package table.
 * Contains the package brief and the deliverables array.
 */
export interface PackageSpec {
  /** Freeform context for the package — product info, messaging, target audience, tone. */
  brief?: string;
  /** Workflow deliverables that make up this package. */
  deliverables: PackageDeliverable[];
}

export interface PackageTemplateSpec {
  /** Unique slug for this package type */
  id: string;
  /** Human-readable label */
  label: string;
  /** Description for humans */
  description: string;
  /** Workflows that make up this package */
  deliverables: PackageDeliverable[];
}

export const PACKAGE_TEMPLATES: Record<string, PackageTemplateSpec> = {
  "influencer-package": {
    id: "influencer-package",
    label: "Influencer Package",
    description:
      "Full influencer outreach with target research, LinkedIn engagement, " +
      "article creation, and multi-channel content distribution",
    deliverables: [
      // 0 — Ghost writes the article FIRST (everything depends on this)
      {
        workflowType: "content-pipeline",
        ownerAgent: "ghost",
        targetCount: 1,
        label: "Article Creation",
        // No pacing — single article, sequential stages
      },
      // 1 — Marni creates LinkedIn posts + connection message from the published article
      // 3 posts over 3 weeks = 1 post per week
      {
        workflowType: "content-distribution",
        ownerAgent: "marni",
        targetCount: 3,
        pacing: {
          batchSize: 1,
          interval: "weekly",
        },
        label: "LinkedIn Content & Messaging",
        blockedBy: [
          {
            deliverableIndex: 0,
            stage: "PUBLISHED",
            reason:
              "Distribution needs the published article URL to create derivative content",
          },
        ],
      },
      // 2 — Scout finds & qualifies targets AFTER article is reviewed
      // No fixed cap — runs 5/day until Tim hits 20 ended sequences
      {
        workflowType: "research-pipeline",
        ownerAgent: "scout",
        targetCount: 0, // No cap — driven by stopWhen
        pacing: {
          batchSize: 5,
          interval: "daily",
        },
        label: "Target Research",
        blockedBy: [
          {
            deliverableIndex: 0,
            stage: "REVIEW",
            reason:
              "Target research should incorporate content from the article — wait until the draft is reviewed",
          },
        ],
        stopWhen: {
          deliverableIndex: 3, // Tim's outreach
          stage: "ENDED",
          count: 20,
          reason: "Scout stops sourcing when 20 targets have completed Tim's outreach sequence",
        },
      },
      // 3 — Tim's outreach as targets arrive from Scout
      // Tim starts as soon as first targets + connection message are ready
      {
        workflowType: "linkedin-outreach",
        ownerAgent: "tim",
        targetCount: 20,
        pacing: {
          batchSize: 5,
          interval: "daily",
        },
        label: "LinkedIn Outreach Cold",
        blockedBy: [
          {
            deliverableIndex: 2,
            stage: "HANDED_OFF",
            reason:
              "Tim needs qualified targets from Scout before initiating outreach",
          },
          {
            deliverableIndex: 1,
            stage: "CONN_MSG_DRAFTED",
            reason:
              "Tim needs the approved connection request message template before sending requests",
          },
        ],
      },
    ],
  },
  // ─── Vibe coding warm outreach (Tim — one contact at a time) ────────────────
  "vibe-coding-outreach": {
    id: "vibe-coding-outreach",
    label: "Warm Outreach",
    description:
      "Warm LinkedIn DMs to existing contacts (vibe coding & AI agent buildout) — one at a time, " +
      "3-message sequence, conversation mode if they reply",
    deliverables: [
      {
        workflowType: "warm-outreach",
        ownerAgent: "tim",
        targetCount: 10,
        label: "Warm Outreach",
      },
    ],
  },

  // ─── AI Article (Ghost-only — single article, no outreach) ────────────────
  "ai-article": {
    id: "ai-article",
    label: "AI Article",
    description:
      "Single article creation using Ghost's AI article builder. " +
      "Ghost builds a campaign spec from a short idea, researches the topic, " +
      "generates the article via Claude Opus, and publishes to strattegys.com.",
    deliverables: [
      {
        workflowType: "content-pipeline",
        ownerAgent: "ghost",
        targetCount: 1,
        label: "Article Creation",
        // No pacing — single article, sequential stages
      },
    ],
  },
};

/** Look up a package template by ID. Returns undefined if not found. */
export function getPackageTemplate(
  id: string
): PackageTemplateSpec | undefined {
  return PACKAGE_TEMPLATES[id];
}
