/**
 * Single JSON config for Suzi’s personal dashboard: weather coordinates, YMCA link, Brave
 * search queries for events, and pinned links. Path: `web/config/suzi-personal-dashboard.json`
 * (relative to the Next.js app root = `web/` when you run from that directory).
 *
 * Schema:
 * - weather: { lat, lon, label, braveQuery? } — Open-Meteo uses lat/lon; optional braveQuery + BRAVE_SEARCH_API_KEY adds a web snippet.
 * - ymca: { scheduleUrl, hint }
 * - eventsSectionSubtitle: string
 * - eventSearchQueries: string[] — max 3 used server-side for Brave (kid-friendly local discovery).
 * - eventLinks, importantLinks, personalLinks: { label, href }[] — importantLinks sit beside weather (with YMCA from ymca).
 */

import "server-only";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const CONFIG_FILENAME = "suzi-personal-dashboard.json";

export type SuziDashboardLink = { label: string; href: string };

export type SuziPersonalDashboardConfig = {
  weather: {
    lat: number;
    lon: number;
    label: string;
    braveQuery?: string | null;
  };
  ymca: { scheduleUrl: string; hint: string };
  eventsSectionSubtitle: string;
  eventSearchQueries: string[];
  eventLinks: SuziDashboardLink[];
  /** Shown next to weather (e.g. school district calendar); YMCA uses ymca.* above. */
  importantLinks: SuziDashboardLink[];
  personalLinks: SuziDashboardLink[];
};

function parseLink(x: unknown): SuziDashboardLink | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.label !== "string" || typeof o.href !== "string") return null;
  const label = o.label.trim();
  const href = o.href.trim();
  if (!label || !href) return null;
  return { label, href };
}

function parseLinks(arr: unknown): SuziDashboardLink[] {
  if (!Array.isArray(arr)) return [];
  const out: SuziDashboardLink[] = [];
  for (const x of arr) {
    const l = parseLink(x);
    if (l) out.push(l);
  }
  return out;
}

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

export function getSuziPersonalDashboardConfig(): SuziPersonalDashboardConfig {
  const configPath = join(process.cwd(), "config", CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    throw new Error(`Missing dashboard config: ${configPath}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  } catch (e) {
    throw new Error(
      `Invalid JSON in ${configPath}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (!raw || typeof raw !== "object") {
    throw new Error(`${configPath} must be a JSON object`);
  }
  const o = raw as Record<string, unknown>;
  const w = o.weather;
  if (!w || typeof w !== "object") {
    throw new Error(`${configPath}: missing weather object`);
  }
  const weatherObj = w as Record<string, unknown>;
  const lat = num(weatherObj.lat, 47.0073);
  const lon = num(weatherObj.lon, -122.9093);
  const label = str(weatherObj.label, "Tumwater, WA");
  const braveQuery =
    typeof weatherObj.braveQuery === "string" && weatherObj.braveQuery.trim()
      ? weatherObj.braveQuery.trim()
      : weatherObj.braveQuery === null
        ? null
        : undefined;

  const ym = o.ymca;
  if (!ym || typeof ym !== "object") {
    throw new Error(`${configPath}: missing ymca object`);
  }
  const ymObj = ym as Record<string, unknown>;
  const scheduleUrl = str(ymObj.scheduleUrl, "");
  const ymHint = str(ymObj.hint, "");
  if (!scheduleUrl) {
    throw new Error(`${configPath}: ymca.scheduleUrl is required`);
  }

  let eventSearchQueries: string[] = [];
  if (Array.isArray(o.eventSearchQueries)) {
    eventSearchQueries = o.eventSearchQueries
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .map((q) => q.trim());
  }

  return {
    weather: { lat, lon, label, braveQuery },
    ymca: { scheduleUrl, hint: ymHint },
    eventsSectionSubtitle: str(
      o.eventsSectionSubtitle,
      "Kid-friendly · ~30 mi · Tumwater area"
    ),
    eventSearchQueries,
    eventLinks: parseLinks(o.eventLinks),
    importantLinks: parseLinks(o.importantLinks),
    personalLinks: parseLinks(o.personalLinks),
  };
}
