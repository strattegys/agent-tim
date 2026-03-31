"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import KanbanBoard from "./KanbanBoard";
import WorkflowSelector from "./WorkflowSelector";
import ItemDetailPanel from "./ItemDetailPanel";
import type { ItemAlert } from "./KanbanCard";
import type { StageConfig, WorkflowItem, WorkflowWithBoard } from "@/lib/board-types";
import { panelBus } from "@/lib/events";

interface KanbanInlinePanelProps {
  onClose: () => void;
  agentId?: string;
  /** Tim pipeline: browse-only, no item detail or workflow edits */
  readOnly?: boolean;
  /** Reserved for embedded kanban layouts (Tim uses work queues instead of inline pipeline). */
  embeddedInTimTabs?: boolean;
  /** Lock to one workflow and hide the selector (Friday workflow drill-down). */
  fixedWorkflowId?: string;
  /** Shown in the slim header when fixedWorkflowId is set. */
  fixedWorkflowLabel?: string;
}

export default function KanbanInlinePanel({
  onClose,
  agentId,
  readOnly = false,
  embeddedInTimTabs = false,
  fixedWorkflowId,
  fixedWorkflowLabel,
}: KanbanInlinePanelProps) {
  const locked = Boolean(fixedWorkflowId);

  const [workflowId, setWorkflowId] = useState(() => {
    if (typeof window === "undefined") return "";
    if (fixedWorkflowId) return fixedWorkflowId;
    return localStorage.getItem("kanban_workflow") || "";
  });
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [alerts, setAlerts] = useState<Record<string, ItemAlert>>({});
  const [selectedItem, setSelectedItem] = useState<WorkflowItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [boardStages, setBoardStages] = useState<StageConfig[]>([]);
  const [boardTransitions, setBoardTransitions] = useState<Record<string, string[]> | undefined>();

  useEffect(() => {
    if (fixedWorkflowId) setWorkflowId(fixedWorkflowId);
  }, [fixedWorkflowId]);

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

  const workflowIdRef = useRef(workflowId);
  workflowIdRef.current = workflowId;

  useEffect(() => {
    setSelectedItem(null);
    fetchItems(workflowId);
    if (workflowId && !locked) localStorage.setItem("kanban_workflow", workflowId);
  }, [workflowId, fetchItems, locked]);

  useEffect(() => {
    if (readOnly) setSelectedItem(null);
  }, [readOnly]);

  // Refresh when agent tools modify CRM data
  useEffect(() => {
    const refetch = () => {
      if (workflowIdRef.current) fetchItems(workflowIdRef.current);
    };
    const u1 = panelBus.on("twenty_crm", refetch);
    const u2 = panelBus.on("workflow_items", refetch);
    const u3 = panelBus.on("dashboard_sync", refetch);
    return () => {
      u1();
      u2();
      u3();
    };
  }, [fetchItems]);

  const handleWorkflowLoaded = useCallback((workflow: WorkflowWithBoard | null) => {
    if (workflow?.board) {
      setBoardStages((workflow.board.stages as StageConfig[]) || []);
      setBoardTransitions(workflow.board.transitions as Record<string, string[]> | undefined);
    } else {
      setBoardStages([]);
      setBoardTransitions(undefined);
    }
  }, []);

  useEffect(() => {
    if (!locked || !workflowId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/crm/workflows");
        const data = await res.json();
        if (cancelled) return;
        const w = (data.workflows || []).find((x: { id: string }) => x.id === workflowId);
        handleWorkflowLoaded(w ?? null);
      } catch {
        if (!cancelled) handleWorkflowLoaded(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locked, workflowId, handleWorkflowLoaded]);

  const timStacked = agentId === "tim";

  const lockedHeader = locked ? (
    <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2 min-w-0">
      <span className="text-xs font-semibold text-[var(--text-primary)] shrink-0">Pipeline</span>
      {fixedWorkflowLabel ? (
        <span className="text-xs text-[var(--text-secondary)] truncate min-w-0">
          {fixedWorkflowLabel}
        </span>
      ) : null}
      {loading && (
        <span className="text-xs text-[var(--text-tertiary)] shrink-0">Loading…</span>
      )}
      <span className="ml-auto text-xs text-[var(--text-tertiary)] shrink-0">
        {items.length > 0 && `${items.length} items`}
      </span>
    </div>
  ) : null;

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      {locked ? (
        lockedHeader
      ) : timStacked ? (
        <>
          {!embeddedInTimTabs && (
            <div className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2">
              <span className="text-xs font-semibold text-[var(--text-primary)]">Pipeline</span>
              <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 leading-snug">
                View-only — pick a workflow, then scan everyone by stage.
              </p>
            </div>
          )}
          <div className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2">
            <WorkflowSelector
              selectedId={workflowId}
              onSelect={setWorkflowId}
              onWorkflowLoaded={handleWorkflowLoaded}
              agentId={agentId}
              readOnly={readOnly}
              fullWidth
            />
            {loading && (
              <span className="text-[10px] text-[var(--text-tertiary)] mt-1 block">Loading…</span>
            )}
          </div>
        </>
      ) : (
        <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
          <span className="text-xs font-semibold text-[var(--text-primary)]">Pipeline</span>

          <WorkflowSelector
            selectedId={workflowId}
            onSelect={setWorkflowId}
            onWorkflowLoaded={handleWorkflowLoaded}
            agentId={agentId}
            readOnly={readOnly}
          />

          {loading && (
            <span className="text-xs text-[var(--text-tertiary)]">Loading...</span>
          )}

          <span className="ml-auto text-xs text-[var(--text-tertiary)] shrink-0">
            {items.length > 0 && `${items.length} items`}
          </span>
        </div>
      )}

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
          selectedItemId={readOnly ? null : selectedItem?.id ?? null}
          onSelectItem={readOnly ? () => {} : setSelectedItem}
        />
      )}

      {/* Detail panel */}
      {selectedItem && !readOnly && (
        <ItemDetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
}
