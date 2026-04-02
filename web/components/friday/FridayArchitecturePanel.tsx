"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { FridayArchitecturePane } from "@/lib/agent-ui-context";

const ArchitectureMermaidView = dynamic(() => import("./ArchitectureMermaidView"), {
  ssr: false,
  loading: () => (
    <p className="text-sm text-[var(--text-tertiary)] px-3 py-4">Loading diagram…</p>
  ),
});

const GRAPH_OVERVIEW = "/architecture/depcruise/graph.mmd";
const GRAPH_LIB = "/architecture/depcruise/graph-lib.mmd";

type CodeVisual = "overview" | "lib";

interface FridayArchitecturePanelProps {
  architecturePane: FridayArchitecturePane;
  onArchitecturePaneChange: (pane: FridayArchitecturePane) => void;
}

export default function FridayArchitecturePanel({
  architecturePane,
  onArchitecturePaneChange,
}: FridayArchitecturePanelProps) {
  const [infraMmd, setInfraMmd] = useState<string | null>(null);
  const [infraError, setInfraError] = useState<string | null>(null);

  const [codeVisual, setCodeVisual] = useState<CodeVisual>("overview");
  const [codeMmd, setCodeMmd] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeReportOk, setCodeReportOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/architecture/infra-overview.mmd")
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load diagram (${r.status})`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) {
          setInfraMmd(text);
          setInfraError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setInfraError(e instanceof Error ? e.message : "Load failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(GRAPH_OVERVIEW, { method: "HEAD" })
      .then((r) => {
        if (!cancelled) setCodeReportOk(r.ok);
      })
      .catch(() => {
        if (!cancelled) setCodeReportOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (architecturePane !== "code") return;
    const path = codeVisual === "overview" ? GRAPH_OVERVIEW : GRAPH_LIB;
    let cancelled = false;
    setCodeMmd(null);
    setCodeError(null);
    fetch(path)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) setCodeMmd(text);
      })
      .catch((e: unknown) => {
        if (!cancelled) setCodeError(e instanceof Error ? e.message : "Load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [architecturePane, codeVisual]);

  const subTabs: { key: FridayArchitecturePane; label: string }[] = [
    { key: "infra", label: "Infrastructure" },
    { key: "code", label: "Code graph" },
  ];

  const codeSubTabs: { key: CodeVisual; label: string; hint: string }[] = [
    { key: "overview", label: "Overview", hint: "app · components · lib (folders collapsed)" },
    { key: "lib", label: "Library", hint: "shared lib/ modules and how they import each other" },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]">
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        {subTabs.map((st) => {
          const active = architecturePane === st.key;
          return (
            <button
              key={st.key}
              type="button"
              onClick={() => onArchitecturePaneChange(st.key)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                active
                  ? "font-semibold text-[var(--text-primary)] bg-[var(--bg-primary)] border border-[var(--border-color)]"
                  : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {st.label}
            </button>
          );
        })}
      </div>

      {architecturePane === "infra" ? (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <p className="shrink-0 text-[11px] text-[var(--text-tertiary)] px-3 py-2 border-b border-[var(--border-color)]">
            Curated overview (edit{" "}
            <code className="text-[10px]">public/architecture/infra-overview.mmd</code>). See{" "}
            <code className="text-[10px]">PROJECT-MEMORY.md</code> for authoritative infra detail.
          </p>
          {infraError ? (
            <p className="text-sm text-red-600 dark:text-red-400 px-3 py-2" role="alert">
              {infraError}
            </p>
          ) : infraMmd ? (
            <ArchitectureMermaidView definition={infraMmd} />
          ) : (
            <p className="text-sm text-[var(--text-tertiary)] px-3 py-4">Loading…</p>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden min-h-[200px]">
          <div className="shrink-0 border-b border-[var(--border-color)] px-3 py-2 space-y-2">
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              <span className="font-medium text-[var(--text-primary)]">How to read:</span> each box is
              a file or collapsed folder. An arrow from{" "}
              <span className="font-mono text-[10px]">A</span> →{" "}
              <span className="font-mono text-[10px]">B</span> means{" "}
              <span className="italic">A imports B</span> (TypeScript/JS module graph from{" "}
              <code className="text-[10px]">dependency-cruiser</code>). This replaces the old matrix
              view.
            </p>
            <div className="flex flex-wrap items-center gap-1">
              {codeSubTabs.map((ct) => {
                const active = codeVisual === ct.key;
                return (
                  <button
                    key={ct.key}
                    type="button"
                    title={ct.hint}
                    onClick={() => setCodeVisual(ct.key)}
                    className={`text-xs px-2 py-0.5 rounded ${
                      active
                        ? "font-semibold bg-[var(--bg-primary)] text-[var(--text-primary)] ring-1 ring-[var(--border-color)]"
                        : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {ct.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-[var(--text-tertiary)]">
              Regenerate graphs from <code className="text-[10px]">COMMAND-CENTRAL/web</code>:{" "}
              <code className="text-[10px]">npm run architecture:report</code>
            </p>
          </div>
          {codeReportOk === null ? (
            <p className="text-sm text-[var(--text-tertiary)] px-3 py-4">Checking for reports…</p>
          ) : codeReportOk === false ? (
            <div className="flex-1 flex flex-col items-start justify-center gap-2 px-4 py-6 text-sm text-[var(--text-secondary)]">
              <p>
                No dependency graphs found (expected <code className="text-xs">{GRAPH_OVERVIEW}</code>
                ).
              </p>
              <p>
                From <code className="text-xs">COMMAND-CENTRAL/web</code> run:
              </p>
              <pre className="text-xs bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-2 overflow-x-auto max-w-full">
                npm run architecture:report
              </pre>
            </div>
          ) : codeError ? (
            <p className="text-sm text-red-600 dark:text-red-400 px-3 py-2" role="alert">
              {codeError}
            </p>
          ) : codeMmd ? (
            <ArchitectureMermaidView definition={codeMmd} />
          ) : (
            <p className="text-sm text-[var(--text-tertiary)] px-3 py-4">Loading graph…</p>
          )}
        </div>
      )}
    </div>
  );
}
