"use client";

import { useState } from "react";
import useSWR from "swr";

interface ToolInfo {
  id: string;
  displayName: string;
  category: "external" | "internal" | "meta";
  description: string;
  externalSystem?: string;
  operations: string[];
  requiresApproval: boolean;
  assignedTo: string[];
}

const CATEGORY_LABELS: Record<string, string> = {
  external: "External",
  internal: "Internal",
  meta: "Meta",
};

const CATEGORY_ICONS: Record<string, string> = {
  external: "🔗",
  internal: "💾",
  meta: "🤖",
};

const AGENT_COLORS: Record<string, string> = {
  tim: "#1D9E75",
  suzi: "#D85A30",
  friday: "#9B59B6",
  scout: "#2563EB",
  ghost: "#4A90D9",
  marni: "#D4A017",
  rainbow: "#534AB7",
  king: "#5a6d7a",
};

export default function ToolsPanel() {
  const { data: toolsData, isLoading: loading } = useSWR<{ tools: ToolInfo[] }>(
    "/api/tools",
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    { revalidateOnFocus: true, dedupingInterval: 30_000 },
  );
  const tools = toolsData?.tools ?? [];
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const filtered =
    filter === "all"
      ? tools
      : tools.filter((t) =>
          filter === "external" || filter === "internal" || filter === "meta"
            ? t.category === filter
            : t.assignedTo.includes(filter)
        );

  // Unique agent IDs across all tools for the agent filter
  const allAgents = Array.from(new Set(tools.flatMap((t) => t.assignedTo))).sort();

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-[var(--text-tertiary)]">Loading tools...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filter bar */}
      <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center gap-2 overflow-x-auto">
        {[
          { key: "all", label: "All" },
          { key: "external", label: "External" },
          { key: "internal", label: "Internal" },
          { key: "meta", label: "Meta" },
        ].map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`shrink-0 text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
              filter === f.key
                ? "font-semibold text-[var(--text-primary)]"
                : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="w-px h-4 bg-[var(--border-color)] mx-0.5 shrink-0" aria-hidden />
        {allAgents.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setFilter(a)}
            className={`shrink-0 text-xs px-2 py-1 rounded cursor-pointer capitalize transition-colors ${
              filter === a
                ? "font-semibold text-[var(--text-primary)]"
                : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {/* Tool cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-[var(--text-tertiary)]">
              No tools match this filter
            </span>
          </div>
        ) : (
          filtered.map((t) => {
            const catLabel = CATEGORY_LABELS[t.category] || t.category;
            const expanded = expandedTool === t.id;

            return (
              <div
                key={t.id}
                className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden cursor-pointer transition-colors hover:border-[var(--text-tertiary)]/30"
                onClick={() => setExpandedTool(expanded ? null : t.id)}
              >
                {/* Card header */}
                <div className="px-3 py-2 flex items-center gap-2">
                  <span className="text-sm opacity-80">{CATEGORY_ICONS[t.category]}</span>
                  <span className="text-xs font-medium text-[var(--text-chat-body)] truncate">
                    {t.displayName}
                  </span>
                  <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-tertiary)]">
                    {catLabel}
                  </span>
                  {t.requiresApproval && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-tertiary)]">
                      Approval
                    </span>
                  )}
                </div>

                {/* Description + agents (always visible) */}
                <div className="px-3 pb-2 space-y-1.5">
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    {t.description}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {t.assignedTo.map((a) => (
                      <span
                        key={a}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-secondary)] font-medium capitalize"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: AGENT_COLORS[a] || "var(--text-tertiary)" }}
                        />
                        {a}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Expanded details */}
                {expanded && (
                  <div className="px-3 pb-3 border-t border-[var(--border-color)] pt-2 space-y-2">
                    {/* External system */}
                    {t.externalSystem && (
                      <div>
                        <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                          Connects to
                        </span>
                        <p className="text-[11px] text-[var(--text-chat-body)] mt-0.5">
                          {t.externalSystem}
                        </p>
                      </div>
                    )}

                    {/* Operations */}
                    <div>
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                        Operations ({t.operations.length})
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.operations.map((op) => (
                          <span
                            key={op}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-tertiary)] font-mono"
                          >
                            {op}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Assigned agents */}
                    <div>
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                        Used by
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.assignedTo.map((a) => (
                          <span
                            key={a}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-secondary)] font-medium capitalize"
                          >
                            {a}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
