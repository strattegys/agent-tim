"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getFrontendAgents } from "@/lib/agent-frontend";
import { MobileSuziPanel } from "./MobileSuziPanel";
import { MobileFridayReadonly } from "./MobileFridayReadonly";
import { MobileTimReadonly } from "./MobileTimReadonly";
import { MobileGenericReadonly } from "./MobileGenericReadonly";
import { LocalDevBackToDesktopChip } from "@/components/LocalDevMobileCheckInChips";

const agents = getFrontendAgents();

export function MobileCheckInShell({ agentId }: { agentId: string }) {
  const current = agents.find((a) => a.id === agentId) ?? agents.find((a) => a.id === "suzi")!;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="relative z-20 flex h-12 shrink-0 items-center border-b border-white/10 bg-[#0e1621] px-2">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-haspopup="listbox"
            className="flex items-center gap-2 rounded-lg p-1.5 pr-3 hover:bg-white/5"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span
              className="relative h-9 w-9 overflow-hidden rounded-full"
              style={{ boxShadow: `0 0 0 2px ${current.color}` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.avatar || `/api/agent-avatar?id=${current.id}`}
                alt=""
                className="h-full w-full object-cover"
              />
            </span>
            <span className="text-left text-sm font-semibold text-[#f5f5f5]">{current.name}</span>
            <span className="text-[#8b9bab] text-xs" aria-hidden>
              ▾
            </span>
          </button>
          {menuOpen ? (
            <ul
              className="absolute left-0 top-full z-30 mt-1 max-h-[min(70vh,28rem)] w-64 overflow-auto rounded-lg border border-white/10 bg-[#131b26] py-1 shadow-xl"
              role="listbox"
            >
              {agents.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/m/${a.id}`}
                    className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/5 ${
                      a.id === agentId ? "bg-white/10 font-medium text-white" : "text-[#e2e4e8]"
                    }`}
                    onClick={() => setMenuOpen(false)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.avatar || `/api/agent-avatar?id=${a.id}`}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover"
                    />
                    {a.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-2 pr-1">
          <span className="text-[10px] uppercase tracking-wide text-[#5c6d7c]">Check-in</span>
          <LocalDevBackToDesktopChip />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        {agentId === "suzi" ? (
          <MobileSuziPanel />
        ) : agentId === "friday" ? (
          <MobileFridayReadonly />
        ) : agentId === "tim" ? (
          <MobileTimReadonly />
        ) : (
          <MobileGenericReadonly agentId={agentId} />
        )}
      </main>
    </div>
  );
}
