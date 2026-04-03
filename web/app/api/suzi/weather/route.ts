import { NextResponse } from "next/server";
import { braveWebSearch } from "@/lib/brave-search";
import { mergeWebEnvLocalSync } from "@/lib/load-web-env-local";
import { getSuziPersonalDashboardConfig } from "@/lib/suzi-personal-dashboard-config";

const TZ = "America/Los_Angeles";
const FORECAST_DAYS = 5;
const BUCKET_MS = 6 * 60 * 60 * 1000;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function modeWeatherCode(codes: number[]): number {
  if (codes.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best = codes[0]!;
  let n = 0;
  for (const [c, cnt] of counts) {
    if (cnt > n) {
      n = cnt;
      best = c;
    }
  }
  return best;
}

/** e.g. 3p, 11a — fits narrow bucket cells */
function hourCompact(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    hour12: true,
  }).formatToParts(new Date(ms));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const ap = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  return `${hour}${ap.charAt(0).toLowerCase()}`;
}

export async function GET() {
  try {
    const config = getSuziPersonalDashboardConfig();
    const { lat, lon, label, braveQuery } = config.weather;

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("current", "temperature_2m,weather_code");
    url.searchParams.set("hourly", "temperature_2m,weather_code");
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,weather_code");
    url.searchParams.set("timezone", TZ);
    url.searchParams.set("forecast_days", String(FORECAST_DAYS));
    url.searchParams.set("past_hours", "24");

    const res = await fetch(url.toString(), { next: { revalidate: 300 } });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Open-Meteo HTTP ${res.status}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        weather_code?: number[];
      };
      daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        weather_code?: number[];
      };
    };

    const currentTempC =
      typeof data.current?.temperature_2m === "number"
        ? data.current.temperature_2m
        : null;
    const weatherCode =
      typeof data.current?.weather_code === "number" ? data.current.weather_code : null;

    const dTime = data.daily?.time ?? [];
    const dMax = data.daily?.temperature_2m_max ?? [];
    const dMin = data.daily?.temperature_2m_min ?? [];
    const dCodes = data.daily?.weather_code ?? [];

    const dailyHighC = typeof dMax[0] === "number" ? dMax[0] : null;
    const dailyLowC = typeof dMin[0] === "number" ? dMin[0] : null;

    const dailyOutlook: { date: string; maxC: number; minC: number; weatherCode: number }[] = [];
    for (let i = 0; i < Math.min(FORECAST_DAYS, dTime.length); i++) {
      const maxC = dMax[i];
      const minC = dMin[i];
      const date = dTime[i];
      const wc = dCodes[i];
      if (
        typeof date === "string" &&
        typeof maxC === "number" &&
        typeof minC === "number" &&
        typeof wc === "number"
      ) {
        dailyOutlook.push({ date, maxC, minC, weatherCode: wc });
      }
    }

    const startMs = Date.now();
    const windowEnd = startMs + WINDOW_MS;

    const times = data.hourly?.time ?? [];
    const hTemps = data.hourly?.temperature_2m ?? [];
    const hCodes = data.hourly?.weather_code ?? [];

    const bucketData: { codes: number[]; temps: number[] }[] = Array.from({ length: 4 }, () => ({
      codes: [],
      temps: [],
    }));

    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (typeof t !== "string") continue;
      const inst = new Date(t).getTime();
      if (Number.isNaN(inst) || inst < startMs || inst >= windowEnd) continue;
      const wc = hCodes[i];
      const tc = hTemps[i];
      if (typeof wc !== "number") continue;
      const idx = Math.min(3, Math.max(0, Math.floor((inst - startMs) / BUCKET_MS)));
      bucketData[idx]!.codes.push(wc);
      if (typeof tc === "number") bucketData[idx]!.temps.push(tc);
    }

    const hourlyBuckets24h: {
      startLabel: string;
      endLabel: string;
      weatherCode: number;
      avgTempC: number;
    }[] = [];

    for (let k = 0; k < 4; k++) {
      const bucketStart = startMs + k * BUCKET_MS;
      const bucketEnd = startMs + (k + 1) * BUCKET_MS;
      const codes = bucketData[k]!.codes;
      const temps = bucketData[k]!.temps;
      const code =
        codes.length > 0
          ? modeWeatherCode(codes)
          : typeof weatherCode === "number"
            ? weatherCode
            : 2;
      const avgTempC =
        temps.length > 0
          ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10
          : typeof currentTempC === "number"
            ? Math.round(currentTempC * 10) / 10
            : 15;

      hourlyBuckets24h.push({
        startLabel: hourCompact(bucketStart),
        endLabel: hourCompact(bucketEnd - 1),
        weatherCode: code,
        avgTempC,
      });
    }

    let braveWeb: { title: string; snippet: string; url: string } | null = null;
    if (braveQuery?.trim()) {
      mergeWebEnvLocalSync();
      try {
        const hits = await braveWebSearch(braveQuery.trim(), 1);
        const h = hits[0];
        if (h?.url) {
          braveWeb = { title: h.title, snippet: h.snippet, url: h.url };
        }
      } catch {
        /* Brave optional; Open-Meteo is canonical */
      }
    }

    return NextResponse.json({
      locationLabel: label,
      currentTempC,
      weatherCode,
      dailyHighC,
      dailyLowC,
      hourlyBuckets24h,
      dailyOutlook,
      braveWeb,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Weather failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
