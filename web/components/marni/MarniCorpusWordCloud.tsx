"use client";

import { useEffect, useRef } from "react";

export type CorpusWord = { word: string; count: number };

type Placed = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  count: number;
  fill: string;
};

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  pad: number
): boolean {
  return !(ax + aw + pad <= bx || bx + bw + pad <= ax || ay + ah + pad <= by || by + bh + pad <= ay);
}

function hitsAny(placed: Placed[], x: number, y: number, w: number, h: number, pad: number): boolean {
  for (const p of placed) {
    if (rectsOverlap(x, y, w, h, p.x, p.y, p.w, p.h, pad)) return true;
  }
  return false;
}

/**
 * Archimedean spiral placement (same idea as d3-cloud / wordcloud layouts): dense, organic word cloud on canvas.
 */
function layoutWords(
  words: CorpusWord[],
  width: number,
  height: number,
  ctx: CanvasRenderingContext2D
): Placed[] {
  const placed: Placed[] = [];
  const minFont = 11;
  const maxFont = 26;
  if (words.length === 0 || width < 40 || height < 40) return placed;

  const maxC = words[0].count;
  const minC = words[words.length - 1].count;
  const cx = width / 2;
  const cy = height / 2;

  for (let i = 0; i < words.length; i++) {
    const { word: text, count } = words[i];
    const t = maxC === minC ? 1 : (count - minC) / (maxC - minC);
    const fontSize = Math.round(minFont + t * (maxFont - minFont));
    ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    const w = Math.min(ctx.measureText(text).width + 2, width - 8);
    const h = fontSize * 1.2;

    let angle = 0;
    const step = 0.22;
    const k = 2.8;
    let placedOne = false;
    for (let n = 0; n < 8000 && !placedOne; n++) {
      const r = k * angle;
      const dx = r * Math.cos(angle);
      const dy = r * Math.sin(angle);
      const x = cx + dx - w / 2;
      const y = cy + dy - h / 2;
      angle += step;
      if (x < 2 || y < 2 || x + w > width - 2 || y + h > height - 2) continue;
      if (hitsAny(placed, x, y, w, h, 1)) continue;
      const hue = 38 + (i % 7) * 4;
      const light = 52 + t * 12;
      placed.push({
        text,
        x,
        y,
        w,
        h,
        fontSize,
        count,
        fill: `hsla(${hue}, 72%, ${light}%, ${0.55 + t * 0.4})`,
      });
      placedOne = true;
    }
  }
  return placed;
}

interface MarniCorpusWordCloudProps {
  terms: CorpusWord[];
  className?: string;
}

export default function MarniCorpusWordCloud({ terms, className }: MarniCorpusWordCloudProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const paint = () => {
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w < 8 || h < 8) return;

      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const sorted = [...terms].sort((a, b) => b.count - a.count);
      const placed = layoutWords(sorted, w, h, ctx);

      for (const p of placed) {
        ctx.font = `600 ${p.fontSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = p.fill;
        ctx.textBaseline = "alphabetic";
        ctx.fillText(p.text, p.x, p.y + p.fontSize * 0.85);
      }
    };

    paint();
    const ro = new ResizeObserver(() => paint());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [terms]);

  return (
    <div ref={wrapRef} className={className ?? "relative h-full w-full min-h-[160px]"}>
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </div>
  );
}
