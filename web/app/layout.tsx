import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CronWarmup } from "@/components/CronWarmup";
import {
  getAppBrandTitle,
  getAppleWebAppShortName,
  getAppHeadline,
  getInstallAppIconPath,
  getLocalRuntimeLabel,
} from "@/lib/app-brand";

const appleWebAppTitle = () => getAppleWebAppShortName();

export function generateMetadata(): Metadata {
  const title = getAppBrandTitle();
  const installIcon = getInstallAppIconPath();
  return {
    title,
    description: getAppHeadline(),
    // Tab favicon: SVG. Home screen / PWA: `app/apple-icon.tsx` (PNG) — linked automatically by Next.
    icons: {
      icon: [{ url: installIcon, type: "image/svg+xml" }],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: appleWebAppTitle(),
    },
  };
}

export function generateViewport(): Viewport {
  const label = getLocalRuntimeLabel();
  const localDev = label === "LOCALDEV" || label === "LOCALDEV_MOBILE";
  return {
    themeColor: localDev ? "#c2410c" : "#0e1621",
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" style={{ backgroundColor: "#0a0f18" }}>
      <body
        className="h-screen"
        style={{
          margin: 0,
          backgroundColor: "#0a0f18",
          color: "#c5c8ce",
        }}
      >
        <CronWarmup />
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/sw.js').catch(() => {});
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
