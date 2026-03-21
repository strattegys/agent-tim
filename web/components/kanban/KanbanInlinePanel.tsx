"use client";

import { useState, useEffect, useCallback } from "react";
import KanbanBoard from "./KanbanBoard";
import WorkflowSelector from "./WorkflowSelector";
import ItemDetailPanel from "./ItemDetailPanel";
import type { ItemAlert } from "./KanbanCard";
import type { StageConfig, WorkflowItem, WorkflowWithBoard } from "@/lib/board-types";

interface KanbanInlinePanelProps {
  onClose: () => void;
  agentId?: string;
}

export default function KanbanInlinePanel({ onClose, agentId }: KanbanInlinePanelProps) {
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
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      {/* Header */}
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
        <span className="text-xs font-semibold text-[var(--text-primary)]">Pipeline</span>

        <WorkflowSelector
          selectedId={workflowId}
          onSelect={setWorkflowId}
          onWorkflowLoaded={handleWorkflowLoaded}
          agentId={agentId}
        />

        {loading && (
          <span className="text-xs text-[var(--text-tertiary)]">Loading...</span>
        )}

        <span className="ml-auto text-xs text-[var(--text-tertiary)] shrink-0">
          {items.length > 0 && `${items.length} items`}
        </span>
      </div>

      {/* Board */}
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

      {/* Detail panel */}
      {selectedItem && (
        <ItemDetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
}
