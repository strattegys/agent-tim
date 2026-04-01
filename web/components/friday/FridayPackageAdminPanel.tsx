"use client";

import { Suspense } from "react";
import type { FridayDashboardTab } from "@/lib/agent-ui-context";
import PackageKanbanBoard from "./PackageKanbanBoard";
import FridayWorkflowTemplatesPanel from "./FridayWorkflowTemplatesPanel";

/** Package-area views mounted from Friday’s top-level tabs (not tasks/tools). */
export type FridayPackageAdminView = Extract<
  FridayDashboardTab,
  "package-kanban" | "wf-templates"
>;

interface FridayPackageAdminPanelProps {
  activeView: FridayPackageAdminView;
}

export default function FridayPackageAdminPanel({ activeView: tab }: FridayPackageAdminPanelProps) {
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
      ) : null}
    </div>
  );
}
