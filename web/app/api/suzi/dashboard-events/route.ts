import { NextResponse } from "next/server";
import { braveWebSearch } from "@/lib/brave-search";
import { mergeWebEnvLocalSync } from "@/lib/load-web-env-local";
import { getSuziPersonalDashboardConfig } from "@/lib/suzi-personal-dashboard-config";

const MAX_QUERIES = 3;
const PER_QUERY = 5;
const MAX_RESULTS = 12;

export async function GET() {
  try {
    mergeWebEnvLocalSync();
    const config = getSuziPersonalDashboardConfig();
    const queries = config.eventSearchQueries.slice(0, MAX_QUERIES);
    if (queries.length === 0) {
      return NextResponse.json({ results: [], braveUnavailable: false });
    }

    if (!process.env.BRAVE_SEARCH_API_KEY?.trim()) {
      return NextResponse.json({ results: [], braveUnavailable: true });
    }

    const seen = new Set<string>();
    const results: { title: string; url: string; snippet: string }[] = [];
    let braveUnavailable = false;

    for (const q of queries) {
      try {
        const hits = await braveWebSearch(q, PER_QUERY);
        for (const h of hits) {
          if (!h.url?.trim() || seen.has(h.url)) continue;
          seen.add(h.url);
          results.push({
            title: h.title,
            url: h.url,
            snippet: h.snippet,
          });
          if (results.length >= MAX_RESULTS) break;
        }
      } catch {
        braveUnavailable = true;
      }
      if (results.length >= MAX_RESULTS) break;
    }

    return NextResponse.json({ results, braveUnavailable });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load events";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
