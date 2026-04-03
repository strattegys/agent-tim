type PerfBucketName = "db" | "service" | "ui";

type PerfSample = {
  ms: number;
  ok: boolean;
  at: number;
};

type PerfBucket = {
  samples: PerfSample[];
};

const MAX_SAMPLES = 200;

const buckets: Record<PerfBucketName, PerfBucket> = {
  db: { samples: [] },
  service: { samples: [] },
  ui: { samples: [] },
};

function pushSample(bucket: PerfBucket, sample: PerfSample): void {
  bucket.samples.push(sample);
  if (bucket.samples.length > MAX_SAMPLES) {
    bucket.samples.splice(0, bucket.samples.length - MAX_SAMPLES);
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(bucket: PerfBucket): {
  count: number;
  errors: number;
  lastMs: number;
  avgMs: number;
  p95Ms: number;
  lastAt: string | null;
} {
  const values = bucket.samples.map((s) => s.ms);
  const count = bucket.samples.length;
  const errors = bucket.samples.filter((s) => !s.ok).length;
  const avgMs =
    count > 0 ? Math.round(values.reduce((sum, n) => sum + n, 0) / count) : 0;
  const p95Ms = count > 0 ? Math.round(percentile(values, 95)) : 0;
  const last = count > 0 ? bucket.samples[count - 1] : null;
  return {
    count,
    errors,
    lastMs: last ? Math.round(last.ms) : 0,
    avgMs,
    p95Ms,
    lastAt: last ? new Date(last.at).toISOString() : null,
  };
}

export function recordDbLatency(ms: number, ok = true): void {
  pushSample(buckets.db, { ms, ok, at: Date.now() });
}

export function recordServiceLatency(ms: number, ok = true): void {
  pushSample(buckets.service, { ms, ok, at: Date.now() });
}

export function recordUiLatency(ms: number, ok = true): void {
  pushSample(buckets.ui, { ms, ok, at: Date.now() });
}

export function getPerfSnapshot(): {
  db: ReturnType<typeof summarize>;
  service: ReturnType<typeof summarize>;
  ui: ReturnType<typeof summarize>;
} {
  return {
    db: summarize(buckets.db),
    service: summarize(buckets.service),
    ui: summarize(buckets.ui),
  };
}
