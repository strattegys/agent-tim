import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node-cron", "pg"],
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
