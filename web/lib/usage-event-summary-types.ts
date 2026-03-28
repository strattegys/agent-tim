/** Shared types for cost summary API and King UI (no server-only). */

export interface UsageSummaryRow {
  application: string;
  surface: string;
  provider: string;
  model: string | null;
  agentId: string | null;
  events: number;
  inputTokens: number;
  outputTokens: number;
  ttsCharacters: number;
  estimatedUsd: number;
}

/** All-time span of rows in `_usage_event` (not limited by the selected Days preset). */
export interface UsageWarehouseCoverage {
  totalRows: number;
  oldestOccurredAt: string | null;
  newestOccurredAt: string | null;
}

export interface CostSummaryResponse {
  from: string;
  to: string;
  workspaceSchema: string;
  /** Full-table min/max so you can see if only ~1 day exists (then 1d vs 30d look identical). */
  coverage: UsageWarehouseCoverage;
  metered: {
    totals: {
      events: number;
      inputTokens: number;
      outputTokens: number;
      ttsCharacters: number;
      estimatedUsd: number;
    };
    byDimension: UsageSummaryRow[];
  };
  configured: {
    unipileMonthlyUsd: number | null;
    notes: string;
  };
}
