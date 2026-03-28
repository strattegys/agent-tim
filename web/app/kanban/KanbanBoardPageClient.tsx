"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import KanbanBoard from "@/components/kanban/KanbanBoard";
import WorkflowSelector from "@/components/kanban/WorkflowSelector";
import ItemDetailPanel from "@/components/kanban/ItemDetailPanel";
import type { ItemAlert } from "@/components/kanban/KanbanCard";
import type { StageConfig, WorkflowItem, WorkflowWithBoard } from "@/lib/board-types";

export default function KanbanBoardPageClient() {
  const [workflowId, setWorkflowId] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("kanban_workflow") || "";
    return "";
  });
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [alerts, setAlerts] = useState<Record<string, ItemAlert>>({});
  const [selectedItem, setSelectedItem] = useState<WorkflowItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [boardStages, setBoardStages] = useState<StageConfig[]>([]);
  const [boardTransitions, setBoardTransitions] = useState<Record<string, string[]> | undefined>();

  const fetchItems = useCallback(async (id: string) => {
    if (!id) {
      setItems([]);
      setAlerts({});
      return;
    }
    setLoading(true);
    try {
      const [itemsRes, alertsRes] = await Promise.all([
        fetch(`/api/crm/workflow-items?workflowId=${id}`),
        fetch(`/api/crm/alerts?workflowId=${id}`),
      ]);
      const itemsData = await itemsRes.json();
      const alertsData = await alertsRes.json();
      setItems(itemsData.items || []);
      setAlerts(alertsData.alerts || {});
    } catch {
      setItems([]);
      setAlerts({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelectedItem(null);
    fetchItems(workflowId);
    if (workflowId) localStorage.setItem("kanban_workflow", workflowId);
  }, [workflowId, fetchItems]);

  const handleWorkflowLoaded = useCallback((workflow: WorkflowWithBoard | null) => {
    if (workflow?.board) {
      setBoardStages((workflow.board.stages as StageConfig[]) || []);
      setBoardTransitions(workflow.board.transitions as Record<string, string[]> | undefined);
    } else {
      setBoardStages([]);
      setBoardTransitions(undefined);
    }
  }, []);

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)]">
      <div className="h-12 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-4 gap-3">
        <Link
          href="/"
          className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
          title="Back to Chat"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </Link>

        <h1 className="text-sm font-semibold text-[var(--text-primary)]">Pipeline</h1>

        <WorkflowSelector
          selectedId={workflowId}
          onSelect={setWorkflowId}
          onWorkflowLoaded={handleWorkflowLoaded}
        />

        {loading && (
          <span className="text-xs text-[var(--text-tertiary)]">Loading...</span>
        )}

        <span className="ml-auto text-xs text-[var(--text-tertiary)]">
          {items.length > 0 && `${items.length} items`}
        </span>
      </div>

      {!workflowId ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[var(--text-tertiary)]">Select a workflow to view the pipeline</p>
        </div>
      ) : items.length === 0 && !loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[var(--text-tertiary)]">No items in this workflow</p>
        </div>
      ) : (
        <KanbanBoard
          stages={boardStages}
          transitions={boardTransitions}
          items={items}
          alerts={alerts}
          selectedItemId={selectedItem?.id ?? null}
          onSelectItem={setSelectedItem}
        />
      )}

      {selectedItem && (
        <ItemDetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
}
