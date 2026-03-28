import "server-only";

import { recordUsageEvent } from "./usage-events";

interface CostResultRow {
  amount?: string;
  currency?: string;
  cost_type?: string;
  model?: string | null;
  description?: string | null;
  [key: string]: unknown;
}

interface CostBucket {
  starting_at?: string;
  ending_at?: string;
  results?: CostResultRow[];
}

interface CostReportResponse {
  data?: CostBucket[];
  has_more?: boolean;
  next_page?: string;
}

/**
 * Pull Anthropic org cost report (Admin API) and append summary rows for reconciliation.
 * Requires ANTHROPIC_ADMIN_API_KEY (sk-ant-admin…).
 */
export async function syncAnthropicCostReportToUsageEvents(options?: {
  days?: number;
}): Promise<{ ok: boolean; buckets: number; rows: number; detail?: string }> {
  const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY?.trim();
  if (!adminKey) {
    return { ok: false, buckets: 0, rows: 0, detail: "ANTHROPIC_ADMIN_API_KEY not set" };
  }

  const days = Math.min(90, Math.max(1, options?.days ?? 7));
  const ending = new Date();
  const starting = new Date(ending);
  starting.setUTCDate(starting.getUTCDate() - days);

  const url = new URL("https://api.anthropic.com/v1/organizations/cost_report");
  url.searchParams.set("starting_at", starting.toISOString());
  url.searchParams.set("ending_at", ending.toISOString());
  url.searchParams.set("bucket_width", "1d");

  const res = await fetch(url.toString(), {
    headers: {
      "x-api-key": adminKey,
      "anthropic-version": "2023-06-01",
    },
  });

  if (!res.ok) {
    const t = await res.text().catch(() => res.statusText);
    return { ok: false, buckets: 0, rows: 0, detail: t.slice(0, 500) };
  }

  const json = (await res.json()) as CostReportResponse;
  const data = json.data ?? [];
  let rows = 0;

  for (const bucket of data) {
    for (const r of bucket.results ?? []) {
      const raw = parseFloat(String(r.amount ?? "0"));
      const currency = (r.currency as string) || "USD";
      const estimatedUsd = Number.isFinite(raw) ? raw : null;

      recordUsageEvent({
        surface: "anthropic_admin_sync",
        provider: "anthropic",
        model: typeof r.model === "string" ? r.model : null,
        estimated_usd: estimatedUsd,
        metadata: {
          bucketStart: bucket.starting_at,
          bucketEnd: bucket.ending_at,
          cost_type: r.cost_type,
          description: r.description,
          currency,
          amountRaw: r.amount,
          source: "anthropic_cost_report",
        },
      });
      rows += 1;
    }
  }

  return { ok: true, buckets: data.length, rows };
}
