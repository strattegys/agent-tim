import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tim",
  description: "AI Assistant",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="h-screen">{children}</body>
    </html>
  );
}
