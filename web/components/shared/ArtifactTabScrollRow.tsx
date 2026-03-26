"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Horizontal tab strip with scroll hints when overflowed; scrolls the active tab into view.
 */
export default function ArtifactTabScrollRow({
  activeIndex,
  children,
  className = "",
  innerClassName = "",
}: {
  activeIndex: number;
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setEdges({
      left: scrollLeft > 2,
      right: scrollLeft < scrollWidth - clientWidth - 2,
    });
  }, []);

  useEffect(() => {
    updateEdges();
  }, [children, updateEdges]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateEdges, { passive: true });
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateEdges);
      ro.disconnect();
    };
  }, [updateEdges]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || activeIndex < 0) return;
    const buttons = el.querySelectorAll("[data-artifact-tab-index]");
    const btn = buttons[activeIndex] as HTMLElement | undefined;
    btn?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeIndex]);

  const btnCls =
    "shrink-0 w-7 h-7 flex items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm font-bold leading-none";

  return (
    <div className={`flex items-stretch gap-0.5 min-w-0 ${className}`}>
      {edges.left ? (
        <button
          type="button"
          className={btnCls}
          title="Scroll to older tabs"
          onClick={() => scrollRef.current?.scrollBy({ left: -180, behavior: "smooth" })}
        >
          ‹
        </button>
      ) : null}
      <div
        ref={scrollRef}
        className={`flex-1 min-w-0 flex gap-1 overflow-x-auto items-center ${innerClassName}`}
        style={{ scrollbarWidth: "none" }}
      >
        {children}
      </div>
      {edges.right ? (
        <button
          type="button"
          className={btnCls}
          title="Scroll to newer tabs"
          onClick={() => scrollRef.current?.scrollBy({ left: 180, behavior: "smooth" })}
        >
          ›
        </button>
      ) : null}
    </div>
  );
}
