"use client";

import { useState, useEffect } from "react";

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

const CATEGORY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  external: { bg: "#1D9E7520", text: "#1D9E75", label: "External" },
  internal: { bg: "#2563EB20", text: "#2563EB", label: "Internal" },
  meta: { bg: "#9B59B620", text: "#9B59B6", label: "Meta" },
};

const CATEGORY_ICONS: Record<string, string> = {
  external: "🔗",
  internal: "💾",
  meta: "🤖",
};

export default function ToolsPanel() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    fetch("/api/tools")
      .then((r) => r.json())
      .then((data) => setTools(data.tools || []))
      .catch(() => setTools([]))
      .finally(() => setLoading(false));
  }, []);

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
      <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] flex items-center gap-1.5 overflow-x-auto">
        {[
          { key: "all", label: "All" },
          { key: "external", label: "External" },
          { key: "internal", label: "Internal" },
          { key: "meta", label: "Meta" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="shrink-0 px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
            style={{
              background:
                filter === f.key
                  ? "var(--accent-color)"
                  : "var(--bg-tertiary)",
              color:
                filter === f.key ? "#fff" : "var(--text-secondary)",
            }}
          >
            {f.label}
          </button>
        ))}
        <span className="w-px h-4 bg-[var(--border-color)] mx-1" />
        {allAgents.map((a) => (
          <button
            key={a}
            onClick={() => setFilter(a)}
            className="shrink-0 px-2 py-0.5 rounded text-[10px] font-medium capitalize transition-colors"
            style={{
              background:
                filter === a ? "var(--accent-color)" : "var(--bg-tertiary)",
              color: filter === a ? "#fff" : "var(--text-secondary)",
            }}
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
            const cat = CATEGORY_COLORS[t.category];
            const expanded = expandedTool === t.id;

            return (
              <div
                key={t.id}
                className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden cursor-pointer transition-colors hover:border-[var(--text-tertiary)]"
                onClick={() => setExpandedTool(expanded ? null : t.id)}
              >
                {/* Card header */}
                <div className="px-3 py-2 flex items-center gap-2">
                  <span className="text-sm">{CATEGORY_ICONS[t.category]}</span>
                  <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                    {t.displayName}
                  </span>
                  <span
                    className="ml-auto shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider"
                    style={{ background: cat.bg, color: cat.text }}
                  >
                    {cat.label}
                  </span>
                  {t.requiresApproval && (
                    <span
                      className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider"
                      style={{ background: "#D85A3020", color: "#D85A30" }}
                    >
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
                        className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-medium capitalize"
                      >
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
                        <p className="text-[11px] text-[var(--text-primary)] mt-0.5">
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
                            className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] font-mono"
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
                            className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-medium capitalize"
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
