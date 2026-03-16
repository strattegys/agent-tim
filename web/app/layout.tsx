import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Strattegys Command Central",
  description: "AI Agent Hub — Tim, Suzi, Rainbow",
  manifest: "/manifest.json",
  icons: {
    icon: "/strattegy-logo.png",
    apple: "/icons/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Command Central",
  },
};

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
    <html lang="en">
      <body className="h-screen">
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
