"use client";

import Link from "next/link";
import {
  showLocalDevMobileCheckInShortcut,
  showLocalDevMobileShellDesktopShortcut,
} from "@/lib/app-brand";

/** Sidebar / mobile list: jump to /m/suzi (same origin, LOCALDEV only). */
export function LocalDevOpenMobileCheckInChip() {
  if (!showLocalDevMobileCheckInShortcut()) return null;
  return (
    <Link
      href="/m/suzi"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f97316]/15 text-[10px] font-bold uppercase tracking-tight text-[#f97316] ring-1 ring-[#f97316]/40 hover:bg-[#f97316]/25"
      title="Open mobile check-in (narrow UI at /m)"
    >
      M
    </Link>
  );
}

/** Mobile /m shell: return to full desktop UI (LOCALDEV only). */
export function LocalDevBackToDesktopChip() {
  if (!showLocalDevMobileShellDesktopShortcut()) return null;
  return (
    <Link
      href="/"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#5B8DEF]/15 text-[10px] font-bold uppercase tracking-tight text-[#7eb7ff] ring-1 ring-[#5B8DEF]/40 hover:bg-[#5B8DEF]/25"
      title="Back to full Command Central"
    >
      D
    </Link>
  );
}
