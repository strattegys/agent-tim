"use client";

import { Suspense } from "react";
import {
  PLANNER_PACKAGE_TEMPLATES,
  type PackageTemplateSpec,
} from "@/lib/package-types";
import type { FridayDashboardTab } from "@/lib/agent-ui-context";
import PackageKanbanBoard from "./PackageKanbanBoard";
import FridayWorkflowTemplatesPanel from "./FridayWorkflowTemplatesPanel";

/** Package-area views mounted from Friday’s top-level tabs (not tasks/tools). */
export type FridayPackageAdminView = Extract<
  FridayDashboardTab,
  "package-kanban" | "pkg-templates" | "wf-templates"
>;

interface FridayPackageAdminPanelProps {
  activeView: FridayPackageAdminView;
}

export default function FridayPackageAdminPanel({ activeView: tab }: FridayPackageAdminPanelProps) {
  const pkgTemplates: PackageTemplateSpec[] = PLANNER_PACKAGE_TEMPLATES;

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      {tab === "package-kanban" ? (
        <PackageKanbanBoard />
      ) : tab === "wf-templates" ? (
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center py-12">
              <p className="text-sm text-[var(--text-tertiary)]">Loading workflow templates…</p>
            </div>
          }
        >
          <FridayWorkflowTemplatesPanel />
        </Suspense>
      ) : tab === "pkg-templates" ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {pkgTemplates.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-12">
              <p className="text-sm text-[var(--text-tertiary)]">No package templates defined</p>
            </div>
          ) : (
            pkgTemplates.map((tmpl) => (
              <div
                key={tmpl.id}
                className="rounded-lg p-3 border border-[var(--border-color)] bg-[var(--bg-secondary)]"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">{tmpl.label}</span>
                  <span className="text-[10px] text-[var(--text-tertiary)] font-mono">{tmpl.id}</span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] mb-2 leading-relaxed">
                  {tmpl.description}
                </p>
                <div className="space-y-1">
                  {tmpl.deliverables.map((d, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]"
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--text-tertiary)] opacity-40" />
                      <span className="text-[var(--text-secondary)]">{d.label}</span>
                      <span className="ml-auto">
                        {d.volumeLabel?.trim() || `${d.targetCount} items`}
                      </span>
                      <span className="text-[var(--text-tertiary)]">{d.ownerAgent}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
