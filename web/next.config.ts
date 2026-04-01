import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["node-cron", "pg", "@anthropic-ai/sdk", "pdf-parse"],
  headers: async () => {
    // Dev: do not cache JS chunks — avoids stale HMR assets and helps with Turbopack chunk timeouts
    // if you use `npm run dev:turbo`. Production: short CDN/browser cache for hashed filenames.
    if (process.env.NODE_ENV !== "production") return [];
    return [
      {
        source: "/_next/static/chunks/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, must-revalidate" },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
