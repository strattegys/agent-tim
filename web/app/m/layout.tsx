import type { Metadata } from "next";
import { getAppBrandTitle } from "@/lib/app-brand";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return {
    title: `${getAppBrandTitle()} · Mobile`,
    description: "Check-in: Suzi intake, read-only agent views",
  };
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-dvh bg-[#0a0f18] text-[#e2e4e8]"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {children}
    </div>
  );
}
