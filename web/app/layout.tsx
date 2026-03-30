import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CronWarmup } from "@/components/CronWarmup";
import {
  getAppBrandTitle,
  getAppleWebAppShortName,
  getAppHeadline,
} from "@/lib/app-brand";

const appleWebAppTitle = () => getAppleWebAppShortName();

export function generateMetadata(): Metadata {
  const title = getAppBrandTitle();
  return {
    title,
    description: getAppHeadline(),
    manifest: "/manifest.json",
    icons: {
      icon: [
        { url: "/icons/app-construction.svg", type: "image/svg+xml" },
      ],
      apple: "/icons/app-construction.svg",
      shortcut: "/icons/app-construction.svg",
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: appleWebAppTitle(),
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#0e1621",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

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
