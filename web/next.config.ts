import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["node-cron", "pg", "@anthropic-ai/sdk", "pdf-parse"],
  headers: async () => [
    {
      source: "/_next/static/chunks/:path*",
      headers: [
        { key: "Cache-Control", value: "public, max-age=3600, must-revalidate" },
      ],
    },
  ],
};

export default nextConfig;
