"use client";

import { WORKFLOW_TYPES, type WorkflowTypeSpec } from "@/lib/workflow-types";
import TemplateCard from "./TemplateCard";

interface FridayTemplatesPanelProps {
  onClose: () => void;
}

export default function FridayTemplatesPanel({ onClose }: FridayTemplatesPanelProps) {
  const templates: WorkflowTypeSpec[] = Object.values(WORKFLOW_TYPES);

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      {/* Header */}
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          Workflow Templates
        </span>
        <span className="ml-auto text-xs text-[var(--text-tertiary)]">
          {templates.length} templates
        </span>
      </div>

      {/* Template list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {templates.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <p className="text-sm text-[var(--text-tertiary)]">No templates defined</p>
          </div>
        ) : (
          templates.map((t) => <TemplateCard key={t.id} template={t} />)
        )}
      </div>
    </div>
  );
}
