/** Shared types for GET /api/crm/workflow-throughput and Friday Goals UI. */

export type ThroughputGoalStatus = "met" | "on_track" | "behind" | "at_risk";

export type WorkflowThroughputRow = {
  workflowTypeId: string;
  workflowLabel: string;
  ownerLabel: string;
  metricLabel: string;
  period: "day" | "week";
  target: number;
  actual: number;
  windowStart: string;
  windowEnd: string;
  elapsedRatio: number;
  status: ThroughputGoalStatus;
  minExpectedByNow: number;
};

/** Count-only row (no target / pace) — e.g. reply-to-close, driven by another workflow. */
export type WorkflowThroughputMeasureRow = {
  workflowTypeId: string;
  workflowLabel: string;
  ownerLabel: string;
  metricLabel: string;
  period: "day" | "week";
  actual: number;
  windowStart: string;
  windowEnd: string;
};

export type WorkflowThroughputPayload = {
  timezone: string;
  items: WorkflowThroughputRow[];
  /** Throughput counts without a goal target */
  measures?: WorkflowThroughputMeasureRow[];
  note?: string;
};
