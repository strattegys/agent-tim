"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MIN_COL_PCT = 4;

export function normalizeColumnPercents(widths: number[]): number[] {
  const w = widths.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) return [...widths];
  return w.map((x) => (x / sum) * 100);
}

export function loadColumnWidths(storageKey: string, defaults: number[], count: number): number[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return normalizeColumnPercents(defaults);
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p) || p.length !== count) return normalizeColumnPercents(defaults);
    const nums = p.map((x) => (typeof x === "number" && x > 0 ? x : 0));
    if (nums.some((n) => n <= 0)) return normalizeColumnPercents(defaults);
    return normalizeColumnPercents(nums);
  } catch {
    return normalizeColumnPercents(defaults);
  }
}

/**
 * Percent widths for a fixed-layout table; drag the right edge of a header cell to resize (persists in localStorage).
 */
export function usePersistentResizableColumns(storageKey: string, defaultPercents: number[]) {
  const count = defaultPercents.length;
  const [widths, setWidths] = useState(() => normalizeColumnPercents(defaultPercents));
  const tableRef = useRef<HTMLTableElement>(null);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const defaultsRef = useRef(defaultPercents);
  defaultsRef.current = defaultPercents;

  useEffect(() => {
    setWidths(loadColumnWidths(storageKey, defaultsRef.current, count));
  }, [storageKey, count]);

  const startResize = useCallback(
    (colIndex: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const tableEl = tableRef.current;
      if (!tableEl || colIndex < 0 || colIndex >= count - 1) return;

      const startX = e.clientX;
      const tableWidth = tableEl.getBoundingClientRect().width;
      const startWidths = [...widthsRef.current];

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const deltaPct = tableWidth > 0 ? (dx / tableWidth) * 100 : 0;
        const pairSum = startWidths[colIndex] + startWidths[colIndex + 1];
        let a = startWidths[colIndex] + deltaPct;
        a = Math.max(MIN_COL_PCT, Math.min(a, pairSum - MIN_COL_PCT));
        const next = [...startWidths];
        next[colIndex] = a;
        next[colIndex + 1] = pairSum - a;
        setWidths(next);
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
        setWidths((w) => {
          const n = normalizeColumnPercents(w);
          try {
            localStorage.setItem(storageKey, JSON.stringify(n));
          } catch {
            /* private mode, quota */
          }
          return n;
        });
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [count, storageKey]
  );

  return { widths, tableRef, startResize };
}
