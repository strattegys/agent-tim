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

export type WorkflowThroughputPayload = {
  timezone: string;
  items: WorkflowThroughputRow[];
  note?: string;
};
