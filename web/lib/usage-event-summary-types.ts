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

export interface CostSummaryResponse {
  from: string;
  to: string;
  workspaceSchema: string;
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
