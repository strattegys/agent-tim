"use client";

import { useEffect, useRef, useState } from "react";

/** Mermaid UMD on window (avoids bundling npm `mermaid`). */
type MermaidRuntime = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
};

const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";

function loadMermaidFromCdn(): Promise<MermaidRuntime> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Mermaid requires a browser context"));
  }
  const w = window as Window & { mermaid?: MermaidRuntime };
  if (w.mermaid && typeof w.mermaid.render === "function") {
    return Promise.resolve(w.mermaid);
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-mermaid-cdn="1"]`);
    if (existing) {
      existing.addEventListener("load", () => {
        const m = w.mermaid;
        if (m && typeof m.render === "function") resolve(m);
        else reject(new Error("Mermaid global missing after shared script load"));
      });
      existing.addEventListener("error", () => reject(new Error("Mermaid script failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = MERMAID_CDN;
    s.async = true;
    s.dataset.mermaidCdn = "1";
    s.onload = () => {
      const m = w.mermaid;
      if (m && typeof m.render === "function") resolve(m);
      else reject(new Error("Mermaid global missing after script load"));
    };
    s.onerror = () => reject(new Error("Could not load Mermaid from CDN"));
    document.head.appendChild(s);
  });
}

interface ArchitectureMermaidViewProps {
  definition: string;
}

export default function ArchitectureMermaidView({ definition }: ArchitectureMermaidViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setErr(null);
        const mermaid = await loadMermaidFromCdn();
        /** Always use a light diagram theme inside the card so contrast matches the slate paper background. */
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            background: "#ffffff",
            mainBkg: "#f1f5f9",
            secondaryColor: "#e2e8f0",
            tertiaryColor: "#cbd5e1",
            primaryTextColor: "#0f172a",
            secondaryTextColor: "#334155",
            lineColor: "#64748b",
            primaryBorderColor: "#94a3b8",
            clusterBkg: "#f8fafc",
            clusterBorder: "#94a3b8",
            titleColor: "#0f172a",
            edgeLabelBackground: "#ffffff",
          },
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: "basis",
          },
          securityLevel: "strict",
        });
        if (cancelled || !hostRef.current) return;
        const id = `mermaid-arch-${Math.random().toString(36).slice(2, 11)}`;
        const { svg } = await mermaid.render(id, definition);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Mermaid render failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [definition]);

  if (err) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400 px-3 py-2 shrink-0" role="alert">
        {err}
      </p>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-auto p-3">
      <div
        className="min-h-[200px] rounded-lg border border-slate-300/80 bg-slate-50 p-4 shadow-sm dark:border-slate-600 dark:bg-slate-100"
        style={{ colorScheme: "light" }}
      >
        <div ref={hostRef} className="text-slate-900 [&_svg]:max-w-full" />
      </div>
    </div>
  );
}
