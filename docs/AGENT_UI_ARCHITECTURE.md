# Agent UI architecture (Command Central)

This document describes the **consistent UX model** for every agent in the main chat layout (`CommandCentralClient`). Follow it when adding or extending agent surfaces so behavior stays predictable and easy to copy.

## Three layers

Each agent uses the same structural stack in the **right column**:

1. **Agent header** (top strip: avatar, name, role, status, shortcuts)
2. **Content below the header** — either the **information panel** or the **work panel** (mutually exclusive for a given moment)
3. **Work tabs** (optional **sub-navigation inside the work panel**)

### 1. Agent header

**Always includes:**

- **Avatar** (click to upload where supported)
- **Name** (agent display name, tinted with agent color)
- **Role line** — short description of what the agent does (from agent registry `role`)
- **Status light** — online / activity signal (e.g. pending work may tint Friday’s dot amber)

**Optional header controls** (icons to the right of the text):

- Shortcuts that **open the work panel** on a default or specific work surface (e.g. Tim’s **list** icon, Friday/Penny **grid**, Suzi **calendar**, **kanban** for agents with a pipeline board).
- **Agent info (ⓘ)** — opens the **information panel** instead of the work panel.

**Principle:** The header is **navigation chrome**. The **work panel** is the **whole region directly under the header** while a work shortcut is selected. Prefer adding **work tabs inside that region** instead of multiplying unrelated header icons.

### 2. Information panel

Opened with **Agent info (ⓘ)**. Renders `AgentInfoPanel`: longer description, capabilities, connections, avatar, etc. This is the **profile / settings / context** surface, separate from operational queues and boards.

### 3. Work panel

The **work panel** is the **space underneath the agent header** when a **work-related header shortcut** is selected (not ⓘ). That includes **all** content in that column below the header: queues, boards, reminders, dashboards, and any **work tabs** row.

**Work tabs (inside the work panel):**

- When an agent needs **more than one** operational view, add a **tab bar inside the work panel** (immediately below the agent header, above the tab’s content).
- Each tab can have a **different purpose** (e.g. Tim: **Active Work Queue** vs **Pending Work Queue**; Friday: Packages vs Human tasks vs Tools). They are **all part of the same work panel**—only the active tab’s content is shown.
- Examples:
  - **Penny** — `PennyDashboardPanel`: Package Planner | Package Templates | Workflow Templates
  - **Friday** — `FridayDashboardPanel`: Packages | Human tasks | Tools
  - **Tim** — `TimAgentPanel`: Active Work Queue | Pending Work Queue
  - **Suzi** — `SuziRemindersPanel`: Punch List | Reminders | Notes | Intake — sub-tab row uses a shared header (`SuziWorkSubTabHeader`): green **command hints** per tab (agent-first copy), optional small orange **human fallback** action only when that tab already has an equivalent (e.g. Intake add modal), and **tap-to-focus** cards (green border) on Intake, Punch List, Reminders, and Notes so the selection is injected into Suzi chat context (`web/lib/suzi-work-panel.ts`).

**Adding a new capability for an agent**

1. If it belongs with existing work, add a **new work tab** inside that agent’s work panel component.
2. If it is a **new top-level surface** (replacing the whole work panel), add a `RightPanel` value in `CommandCentralClient.tsx` and wire routing in the `rightPanel` / `activeAgent` switch.
3. Add a **new header icon** only when it is a **distinct top-level entry** (e.g. first open to the work panel from Agent info), not for every sub-screen.

## Reference table (current patterns)

| Agent  | Work entry (header shortcut)     | Work panel component        | Work tabs (examples)                                      |
|--------|----------------------------------|-----------------------------|-----------------------------------------------------------|
| Friday | Packages dashboard (grid icon) | `FridayDashboardPanel`      | Packages, Human tasks, Tools                              |
| Penny  | Packages dashboard (grid icon) | `PennyDashboardPanel`       | Package Planner, Package Templates, Workflow Templates    |
| Tim    | Work panel (list icon)           | `TimAgentPanel`             | Active Work Queue, Pending Work Queue                     |
| Suzi   | Reminders (calendar icon)      | `SuziRemindersPanel`        | Punch List, Reminders, Notes, Intake                       |
| Others | Kanban where `agentHasKanban`  | `KanbanInlinePanel` or info | As needed                                                 |

## Key files

- **Routing and header chrome:** `web/app/CommandCentralClient.tsx` (`RightPanel`, header buttons, which component mounts for each agent).
- **Agent metadata (name, role, color, capabilities):** `web/lib/agent-registry.ts` and `web/lib/agent-frontend.ts` (`agentHasKanban`, etc.).
- **Example multi-tab work panels:**  
  `web/components/penny/PennyDashboardPanel.tsx`  
  `web/components/friday/FridayDashboardPanel.tsx`  
  `web/components/tim/TimAgentPanel.tsx`  
  `web/components/suzi/SuziRemindersPanel.tsx` (or equivalent Suzi panel path in repo)

## Deep links

Query params such as `?agent=friday&panel=…` map to `RightPanel` where supported. For example, `panel=tasks` for Friday is interpreted as **dashboard + Human tasks tab** so bookmarks and links keep working without a separate top-level `tasks` panel.

For **Suzi**, `?agent=suzi&panel=reminders&suziSub=intake` opens the work panel and selects the **Intake** sub-tab (e.g. after PWA share redirect).

---

*Keep this document aligned with `CommandCentralClient` when you change defaults or add agents.*
