/**
 * Client-side event bus for panel refresh notifications.
 *
 * When an agent uses a tool that modifies data, the chat stream emits
 * a "toolUsed" SSE event. The chat page picks it up and fires
 * panelBus.emit(toolName) so any open panel can refetch.
 *
 * panelBus.emit("dashboard_sync") — refresh CRM badge counts + notifications
 * (Command Central listens and hits /api/dashboard-sync). Emit after human-task
 * resolves (Friday/Tim/Ghost), Penny package activate/reset/draft, orphan
 * migration, new package, etc., when header/rail counts may change outside chat.
 */

type Listener = () => void;

class PanelEventBus {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  emit(event: string) {
    this.listeners.get(event)?.forEach((fn) => fn());
  }
}

export const panelBus = new PanelEventBus();
