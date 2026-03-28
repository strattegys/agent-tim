import "server-only";

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { query, CRM_WORKSPACE_SCHEMA } from "./db";
import type {
  CostSummaryResponse,
  UsageSummaryRow,
  UsageWarehouseCoverage,
} from "./usage-event-summary-types";

export type {
  CostSummaryResponse,
  UsageSummaryRow,
  UsageWarehouseCoverage,
} from "./usage-event-summary-types";

const APP_COMMAND_CENTRAL = "command-central";

export type UsageSurface =
  | "llm"
  | "tts"
  | "unipile_proxy"
  | "anthropic_admin_sync";

export interface UsageEventInput {
  application?: string;
  surface: UsageSurface;
  provider: string;
  model?: string | null;
  agent_id?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  tts_characters?: number | null;
  estimated_usd?: number | null;
  request_id?: string | null;
  metadata?: Record<string, unknown>;
  occurred_at?: Date;
}

interface StoredRow {
  id: string;
  occurredAt: string;
  application: string;
  surface: string;
  provider: string;
  model: string | null;
  agentId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  ttsCharacters: number | null;
  estimatedUsd: number | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
}

const USE_PG = !!process.env.CRM_DB_PASSWORD?.trim();
const DEV_FILE = join(process.cwd(), ".dev-store", "usage_events.jsonl");

function ensureDevDir() {
  const dir = join(process.cwd(), ".dev-store");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function rowFromInput(input: UsageEventInput): StoredRow {
  const occurred = input.occurred_at ?? new Date();
  return {
    id: randomUUID(),
    occurredAt: occurred.toISOString(),
    application: input.application ?? APP_COMMAND_CENTRAL,
    surface: input.surface,
    provider: input.provider,
    model: input.model ?? null,
    agentId: input.agent_id ?? null,
    inputTokens:
      input.input_tokens != null && Number.isFinite(input.input_tokens)
        ? Math.round(input.input_tokens)
        : null,
    outputTokens:
      input.output_tokens != null && Number.isFinite(input.output_tokens)
        ? Math.round(input.output_tokens)
        : null,
    ttsCharacters:
      input.tts_characters != null && Number.isFinite(input.tts_characters)
        ? Math.round(input.tts_characters)
        : null,
    estimatedUsd:
      input.estimated_usd != null && Number.isFinite(input.estimated_usd)
        ? input.estimated_usd
        : null,
    requestId: input.request_id ?? null,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

async function insertPostgres(row: StoredRow): Promise<void> {
  await query(
    `INSERT INTO "_usage_event" (
      "id", "occurredAt", "application", "surface", "provider", "model", "agentId",
      "inputTokens", "outputTokens", "ttsCharacters", "estimatedUsd", "requestId", "metadata"
    ) VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
    [
      row.id,
      row.occurredAt,
      row.application,
      row.surface,
      row.provider,
      row.model,
      row.agentId,
      row.inputTokens,
      row.outputTokens,
      row.ttsCharacters,
      row.estimatedUsd,
      row.requestId,
      JSON.stringify(row.metadata),
    ]
  );
}

function appendDevJsonl(row: StoredRow): void {
  ensureDevDir();
  appendFileSync(DEV_FILE, `${JSON.stringify(row)}\n`, "utf-8");
}

/**
 * Fire-and-forget usage record. Safe to call from hot paths; failures are logged only.
 */
export function recordUsageEvent(input: UsageEventInput): void {
  const row = rowFromInput(input);
  if (USE_PG) {
    void insertPostgres(row).catch((e) => {
      console.warn("[usage-events] postgres insert failed:", e);
    });
  } else {
    try {
      appendDevJsonl(row);
    } catch (e) {
      console.warn("[usage-events] dev file append failed:", e);
    }
  }
}

function parseDevRows(): StoredRow[] {
  if (!existsSync(DEV_FILE)) return [];
  const raw = readFileSync(DEV_FILE, "utf-8");
  const rows: StoredRow[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t) as StoredRow);
    } catch {
      /* skip */
    }
  }
  return rows;
}

function unipileMonthlyUsd(): number | null {
  const v = process.env.UNIPILE_MONTHLY_USD?.trim();
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** pg often returns COUNT/SUM as string (int8); tolerate number/bigint. */
function parseSqlAggInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return 0;
    const n = Number(t);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

function parseSqlAggUsd(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function occurredAtToIso(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  const t = d.getTime();
  return Number.isNaN(t) ? null : d.toISOString();
}

/** Min/max/count across all `_usage_event` rows (warehouse span). */
async function loadUsageWarehouseCoverage(): Promise<UsageWarehouseCoverage> {
  if (USE_PG) {
    const rows = await query<{
      c: unknown;
      min_a: unknown;
      max_a: unknown;
    }>(
      `SELECT COUNT(*)::text AS c,
              MIN("occurredAt") AS min_a,
              MAX("occurredAt") AS max_a
       FROM "_usage_event"`
    );
    const r = rows[0];
    if (!r) {
      return { totalRows: 0, oldestOccurredAt: null, newestOccurredAt: null };
    }
    return {
      totalRows: parseSqlAggInt(r.c),
      oldestOccurredAt: occurredAtToIso(r.min_a),
      newestOccurredAt: occurredAtToIso(r.max_a),
    };
  }

  const all = parseDevRows();
  if (all.length === 0) {
    return { totalRows: 0, oldestOccurredAt: null, newestOccurredAt: null };
  }
  let oldest = all[0]!.occurredAt;
  let newest = all[0]!.occurredAt;
  for (const row of all) {
    if (row.occurredAt < oldest) oldest = row.occurredAt;
    if (row.occurredAt > newest) newest = row.occurredAt;
  }
  return {
    totalRows: all.length,
    oldestOccurredAt: occurredAtToIso(oldest),
    newestOccurredAt: occurredAtToIso(newest),
  };
}

/**
 * Token-heavy rows first (LLM/TTS), then event count.
 * Sorting by events alone kept integration pings (many Ev, 0 In/Out) above LLM rows, so changing
 * the day window looked like In/Out “didn’t filter” while only noisy Ev counts moved.
 */
function sortUsageRowsByImpact(rows: UsageSummaryRow[]): UsageSummaryRow[] {
  return [...rows].sort((a, b) => {
    const volA = a.inputTokens + a.outputTokens + a.ttsCharacters;
    const volB = b.inputTokens + b.outputTokens + b.ttsCharacters;
    if (volB !== volA) return volB - volA;
    if (b.events !== a.events) return b.events - a.events;
    const ka = `${a.application}\0${a.surface}\0${a.provider}\0${a.agentId ?? ""}\0${a.model ?? ""}`;
    const kb = `${b.application}\0${b.surface}\0${b.provider}\0${b.agentId ?? ""}\0${b.model ?? ""}`;
    return ka.localeCompare(kb);
  });
}

export async function buildUsageSummary(
  fromIso: string,
  toIso: string
): Promise<CostSummaryResponse> {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("Invalid from/to date");
  }

  let byDimension: UsageSummaryRow[] = [];

  if (USE_PG) {
    const rows = await query<{
      application: string;
      surface: string;
      provider: string;
      model: string | null;
      agentId: string | null;
      events: unknown;
      inputTokens: unknown;
      outputTokens: unknown;
      ttsCharacters: unknown;
      estimatedUsd: unknown;
    }>(
      `SELECT "application", "surface", "provider", "model", "agentId",
        COUNT(*)::text AS "events",
        COALESCE(SUM("inputTokens"), 0)::text AS "inputTokens",
        COALESCE(SUM("outputTokens"), 0)::text AS "outputTokens",
        COALESCE(SUM("ttsCharacters"), 0)::text AS "ttsCharacters",
        COALESCE(SUM("estimatedUsd"), 0)::text AS "estimatedUsd"
       FROM "_usage_event"
       WHERE "occurredAt" >= $1::timestamptz AND "occurredAt" < $2::timestamptz
       GROUP BY "application", "surface", "provider", "model", "agentId"
       ORDER BY "application", "surface", "provider"`,
      [from.toISOString(), to.toISOString()]
    );
    byDimension = rows.map((r) => ({
      application: r.application,
      surface: r.surface,
      provider: r.provider,
      model: r.model,
      agentId: r.agentId,
      events: parseSqlAggInt(r.events),
      inputTokens: parseSqlAggInt(r.inputTokens),
      outputTokens: parseSqlAggInt(r.outputTokens),
      ttsCharacters: parseSqlAggInt(r.ttsCharacters),
      estimatedUsd: parseSqlAggUsd(r.estimatedUsd),
    }));
  } else {
    const all = parseDevRows();
    const fromMs = from.getTime();
    const toMs = to.getTime();
    const filtered = all.filter((r) => {
      const t = new Date(r.occurredAt).getTime();
      return t >= fromMs && t < toMs;
    });
    const map = new Map<string, UsageSummaryRow>();
    for (const r of filtered) {
      const key = [
        r.application,
        r.surface,
        r.provider,
        r.model ?? "",
        r.agentId ?? "",
      ].join("\0");
      const cur = map.get(key) ?? {
        application: r.application,
        surface: r.surface,
        provider: r.provider,
        model: r.model,
        agentId: r.agentId,
        events: 0,
        inputTokens: 0,
        outputTokens: 0,
        ttsCharacters: 0,
        estimatedUsd: 0,
      };
      cur.events += 1;
      cur.inputTokens += r.inputTokens ?? 0;
      cur.outputTokens += r.outputTokens ?? 0;
      cur.ttsCharacters += r.ttsCharacters ?? 0;
      cur.estimatedUsd += r.estimatedUsd ?? 0;
      map.set(key, cur);
    }
    byDimension = Array.from(map.values());
  }

  byDimension = sortUsageRowsByImpact(byDimension);

  const totals = byDimension.reduce(
    (acc, r) => ({
      events: acc.events + r.events,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      ttsCharacters: acc.ttsCharacters + r.ttsCharacters,
      estimatedUsd: acc.estimatedUsd + r.estimatedUsd,
    }),
    {
      events: 0,
      inputTokens: 0,
      outputTokens: 0,
      ttsCharacters: 0,
      estimatedUsd: 0,
    }
  );

  const coverage = await loadUsageWarehouseCoverage();

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    workspaceSchema: CRM_WORKSPACE_SCHEMA,
    coverage,
    metered: { totals, byDimension },
    configured: {
      unipileMonthlyUsd: unipileMonthlyUsd(),
      notes:
        "Unipile is seat-based; UNIPILE_MONTHLY_USD is a manual monthly line item for dashboards.",
    },
  };
}

/** Plain-text summary for King tool / chat. */
export async function formatUsageSummaryText(
  fromIso: string,
  toIso: string
): Promise<string> {
  const s = await buildUsageSummary(fromIso, toIso);
  const lines: string[] = [
    `Usage summary (${s.from.slice(0, 10)} → ${s.to.slice(0, 10)} UTC)`,
    `Warehouse: ${s.coverage.totalRows} row(s); span ${
      s.coverage.oldestOccurredAt?.slice(0, 19) ?? "—"
    }Z → ${s.coverage.newestOccurredAt?.slice(0, 19) ?? "—"}Z (all-time min/max)`,
    `Total events: ${s.metered.totals.events}`,
    `LLM input tokens: ${s.metered.totals.inputTokens}`,
    `LLM output tokens: ${s.metered.totals.outputTokens}`,
    `TTS characters: ${s.metered.totals.ttsCharacters}`,
    `Estimated USD (logged): ${s.metered.totals.estimatedUsd.toFixed(4)}`,
  ];
  if (s.configured.unipileMonthlyUsd != null) {
    lines.push(
      `Configured Unipile (monthly): USD ${s.configured.unipileMonthlyUsd.toFixed(2)}`
    );
  }
  if (s.metered.byDimension.length > 0) {
    lines.push("", "By app / surface / provider (top dimensions):");
    for (const r of s.metered.byDimension.slice(0, 24)) {
      lines.push(
        `- ${r.application} | ${r.surface} | ${r.provider}` +
          (r.agentId ? ` | agent=${r.agentId}` : "") +
          (r.model ? ` | model=${r.model}` : "") +
          ` | events=${r.events} in=${r.inputTokens} out=${r.outputTokens} tts=${r.ttsCharacters}`
      );
    }
    if (s.metered.byDimension.length > 24) {
      lines.push(`… and ${s.metered.byDimension.length - 24} more grouped rows`);
    }
  }
  return lines.join("\n");
}
