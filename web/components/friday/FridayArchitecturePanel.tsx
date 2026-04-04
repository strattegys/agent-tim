"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { FridayArchitecturePane } from "@/lib/agent-ui-context";

const ArchitectureMermaidView = dynamic(() => import("./ArchitectureMermaidView"), {
  ssr: false,
  loading: () => (
    <p className="text-sm text-[var(--text-tertiary)] px-3 py-4">Loading diagram…</p>
  ),
});

const GRAPH_LIB = "/architecture/depcruise/graph-lib.mmd";

const PANE_TO_PATH: Record<FridayArchitecturePane, string> = {
  p1a: "/architecture/pillars/1a-runtime-topology.mmd",
  p1b: "/architecture/pillars/1b-edge-trust.mmd",
  p1c: "/architecture/pillars/1c-config-env.mmd",
  p2a: "/architecture/pillars/2a-api-surface.mmd",
  p2b: "/architecture/pillars/2b-async-webhooks-cron.mmd",
  p2c: "/architecture/pillars/2c-client-navigation.mmd",
  p3a: "/architecture/pillars/3a-data-model.mmd",
  p3b: "/architecture/pillars/3b-agents-tools.mmd",
  p3c: "/architecture/pillars/3c-module-boundaries.mmd",
  infra_curated: "/architecture/infra-overview.mmd",
  code_lib: GRAPH_LIB,
};

type Principal = "p1" | "p2" | "p3";

const PRINCIPAL_LABEL: Record<Principal, string> = {
  p1: "Platform",
  p2: "Interfaces",
  p3: "Domain",
};

const PANE_META: Record<
  FridayArchitecturePane,
  { principal: Principal; sub: "a" | "b" | "c" | "x"; label: string; hint: string }
> = {
  p1a: {
    principal: "p1",
    sub: "a",
    label: "Runtime",
    hint: "Docker Compose services and depends_on (root docker-compose.yml)",
  },
  p1b: {
    principal: "p1",
    sub: "b",
    label: "Edge & trust",
    hint: "Middleware + public path patterns from middleware.ts",
  },
  p1c: {
    principal: "p1",
    sub: "c",
    label: "Configuration",
    hint: "Env keys grouped from .env.local.example",
  },
  p2a: {
    principal: "p2",
    sub: "a",
    label: "HTTP API",
    hint: "app/api/**/route.ts — methods per route group",
  },
  p2b: {
    principal: "p2",
    sub: "b",
    label: "Async & crons",
    hint: "Webhooks, /api/cron, /api/dev, node-cron catalog",
  },
  p2c: {
    principal: "p2",
    sub: "c",
    label: "Pages",
    hint: "App Router page.tsx paths (non-api)",
  },
  p3a: {
    principal: "p3",
    sub: "a",
    label: "Data model",
    hint: "CREATE TABLE from web/scripts/migrate*.sql",
  },
  p3b: {
    principal: "p3",
    sub: "b",
    label: "Agents",
    hint: "Tools and delegation from agent-registry.ts",
  },
  p3c: {
    principal: "p3",
    sub: "c",
    label: "Modules",
    hint: "dependency-cruiser (app + components + lib, collapsed)",
  },
  infra_curated: {
    principal: "p1",
    sub: "x",
    label: "Curated infra",
    hint: "Hand-maintained story — public/architecture/infra-overview.mmd",
  },
  code_lib: {
    principal: "p3",
    sub: "x",
    label: "Lib graph",
    hint: "dependency-cruiser lib/ only (finer detail)",
  },
};

function principalForPane(p: FridayArchitecturePane): Principal {
  return PANE_META[p].principal;
}

interface FridayArchitecturePanelProps {
  architecturePane: FridayArchitecturePane;
  onArchitecturePaneChange: (pane: FridayArchitecturePane) => void;
}

export default function FridayArchitecturePanel({
  architecturePane,
  onArchitecturePaneChange,
}: FridayArchitecturePanelProps) {
  const [mmd, setMmd] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exists, setExists] = useState<boolean | null>(null);

  const path = PANE_TO_PATH[architecturePane];

  const principal = principalForPane(architecturePane);
  const subPanes = useMemo(() => {
    const core: FridayArchitecturePane[] = ["p1a", "p1b", "p1c"];
    if (principal === "p2") return ["p2a", "p2b", "p2c"] as const;
    if (principal === "p3")
      return ["p3a", "p3b", "p3c", "code_lib"] as FridayArchitecturePane[];
    return [...core, "infra_curated"] as FridayArchitecturePane[];
  }, [principal]);

  useEffect(() => {
    let cancelled = false;
    setExists(null);
    fetch(path, { method: "HEAD" })
      .then((r) => {
        if (!cancelled) setExists(r.ok);
      })
      .catch(() => {
        if (!cancelled) setExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    setMmd(null);
    setLoadError(null);
    fetch(path)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load (${r.status})`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) {
          setMmd(text);
          setLoadError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const meta = PANE_META[architecturePane];

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]">
      <div className="shrink-0 flex flex-col gap-1.5 px-2 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <div className="flex flex-wrap items-center gap-1">
          {(["p1", "p2", "p3"] as const).map((pid) => {
            const active = principal === pid;
            const first =
              pid === "p1" ? "p1a" : pid === "p2" ? "p2a" : "p3a";
            return (
              <button
                key={pid}
                type="button"
                onClick={() => {
                  if (!active) onArchitecturePaneChange(first);
                }}
                className={`text-xs px-2.5 py-1 rounded transition-colors ${
                  active
                    ? "font-semibold text-[var(--text-primary)] bg-[var(--bg-primary)] border border-[var(--border-color)]"
                    : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {PRINCIPAL_LABEL[pid]}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {subPanes.map((key) => {
            const m = PANE_META[key];
            const active = architecturePane === key;
            return (
              <button
                key={key}
                type="button"
                title={m.hint}
                onClick={() => onArchitecturePaneChange(key)}
                className={`text-xs px-2 py-0.5 rounded ${
                  active
                    ? "font-semibold bg-[var(--bg-primary)] text-[var(--text-primary)] ring-1 ring-[var(--border-color)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="shrink-0 text-[11px] text-[var(--text-tertiary)] px-3 py-2 border-b border-[var(--border-color)]">
        <span className="font-medium text-[var(--text-secondary)]">{meta.label}:</span> {meta.hint}
        {" · "}
        <code className="text-[10px]">{path.replace(/^\//, "")}</code>
        {" · "}
        Regenerate: <code className="text-[10px]">npm run architecture:generate</code> (from{" "}
        <code className="text-[10px]">web/</code>)
      </p>

      {exists === false ? (
        <div className="flex-1 flex flex-col items-start justify-center gap-2 px-4 py-6 text-sm text-[var(--text-secondary)]">
          <p>
            Missing <code className="text-xs">{path}</code>. Run from <code className="text-xs">web/</code>:
          </p>
          <pre className="text-xs bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-2 overflow-x-auto max-w-full">
            npm run architecture:generate
          </pre>
        </div>
      ) : loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400 px-3 py-2" role="alert">
          {loadError}
        </p>
      ) : mmd ? (
        <ArchitectureMermaidView definition={mmd} />
      ) : (
        <p className="text-sm text-[var(--text-tertiary)] px-3 py-4">Loading…</p>
      )}
    </div>
  );
}
