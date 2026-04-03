# Agent UI architecture (Command Central)

This document describes the **consistent UX model** for every agent in the main chat layout (`CommandCentralClient`). Follow it when adding or extending agent surfaces so behavior stays predictable and easy to copy.

**Related:** [`docs/PHASE-1-AGENT-READINESS.md`](PHASE-1-AGENT-READINESS.md) (consolidated operational plan) | [`docs/PENNY-PACKAGE-SALES-PLAN.md`](PENNY-PACKAGE-SALES-PLAN.md) (Penny workspace wireframes + account data model)

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
- **Knowledge base** — same **book** glyph as **System monitor → Agents** (far-right icon per row): `KnowledgeRagIcon`. Sits **immediately to the right of ⓘ**. Opens `agent-knowledge` / `AgentKnowledgePanel` (Knowledge Studio for Marni and Tim; empty state for others). **Health** for Marni/Tim (green / amber / red from Data Platform) is shown on that System monitor book icon, not duplicated on the header.

**Principle:** The header is **navigation chrome**. The **work panel** is the **whole region directly under the header** while a work shortcut is selected. Prefer **work tabs inside the work panel** for operational views. **Knowledge** is intentionally **not** a work sub-tab—it uses the **book** header control (e.g. Marni’s research KB moved out of the Marni work panel tab bar).

### 2. Information panel

Opened with **Agent info (ⓘ)**. Renders `AgentInfoPanel`: longer description, capabilities, connections, avatar, etc. This is the **profile / settings / context** surface, separate from operational queues and boards.

### 3. Work panel

The **work panel** is the **space underneath the agent header** when a **work-related header shortcut** is selected (not ⓘ). That includes **all** content in that column below the header: queues, boards, reminders, dashboards, and any **work tabs** row.

**Work tabs (inside the work panel):**

- When an agent needs **more than one** operational view, add a **tab bar inside the work panel** (immediately below the agent header, above the tab’s content).
- Each tab can have a **different purpose** (e.g. Tim: **Active Work Queue** vs **Pending Work Queue**; Friday: six top-level tabs below). They are **all part of the same work panel**—only the active tab’s content is shown.
- Examples:
  - **Friday** — `FridayDashboardPanel`: **Goals** (throughput vs targets from `workflow-types.ts`) | **Queue** | **Planner** | **Package templates** | **Workflow templates** | **Tools**. **Queue** shows operational packages with per-workflow step counts and a **Board** button to open the Kanban for that workflow. Package/planner/template bodies live in `FridayPackageAdminPanel` (no nested tab row).
  - **Tim** — `TimAgentPanel`: Active Work Queue | Pending Work Queue
  - **Suzi** — `SuziRemindersPanel`: Punch List | Reminders | Notes | Intake — sub-tab row uses a shared header (`SuziWorkSubTabHeader`): green **command hints** per tab (agent-first copy), optional small orange **human fallback** action only when that tab already has an equivalent (e.g. Intake add modal), and **tap-to-focus** cards (green border) on Intake, Punch List, Reminders, and Notes so the selection is injected into Suzi chat context (`web/lib/suzi-work-panel.ts`).

**Adding a new capability for an agent**

1. If it belongs with existing work, add a **new work tab** inside that agent’s work panel component.
2. If it is a **new top-level surface** (replacing the whole work panel), add a `RightPanel` value in `CommandCentralClient.tsx` and wire routing in the `rightPanel` / `activeAgent` switch.
3. Add a **new header icon** only when it is a **distinct top-level entry** (e.g. first open to the work panel from Agent info), not for every sub-screen.

**Chat context for work panels:** Each agent's work panel can inject context into the LLM chat (e.g. Suzi's `formatSuziWorkPanelContext`, Penny's planned `formatPennyWorkPanelContext`). This enables the agent to give contextually relevant suggestions based on what the user is looking at.

## Knowledge panel (book icon)

- **Component:** `web/components/agents/AgentKnowledgePanel.tsx` — switches on `activeAgent` (Marni → `MarniKnowledgePanel`, Tim → placeholder / future Govind+corpus UI, others → empty state).
- **Routing:** `RightPanel` value `agent-knowledge` in `CommandCentralClient.tsx`.
- **Chat context:** `formatAgentUiContext` in `web/lib/agent-ui-context.ts` (e.g. Marni topic focus when the book panel is open).

## Reference table (current patterns)

| Agent  | Work entry (header shortcut)     | Work panel component        | Work tabs (examples)                                      | Knowledge (book)        |
|--------|----------------------------------|-----------------------------|-----------------------------------------------------------|-------------------------|
| Friday | Dashboard (grid icon)            | `FridayDashboardPanel`      | Goals, Package Kanban, Workflow templates, Tools, Cron     | Placeholder             |
| Penny  | Account hub (building icon)      | `PennyWorkPanel`            | **Accounts**, Pipeline, Health, Products                  | Placeholder             |
| Tim    | Work panel (list icon)           | `TimAgentPanel`             | Active Work Queue, Pending Work Queue                     | Tim KB placeholder      |
| Marni  | Work panel (list icon)         | `MarniWorkPanel` → Kanban   | _(none — single queue)_                                   | Full Marni KB           |
| Suzi   | Reminders (calendar icon)      | `SuziRemindersPanel`        | Punch List, Reminders, Notes, Intake                       | Placeholder             |
| Others | Kanban where `agentHasKanban`  | `KanbanInlinePanel` or info | As needed                                                 | Placeholder             |

**Penny's workspace** is designed as an **account-centric** hub (vs Friday's ops-centric dashboard). An **account** = a `company` row in the CRM; the account stage is **derived** from aggregate package/workflow state (Lead → Proposal → Customer → Delivered). See [`docs/PENNY-PACKAGE-SALES-PLAN.md`](PENNY-PACKAGE-SALES-PLAN.md) for the full workspace design including wireframes, data sources, and implementation plan. Routing: `CommandCentralRightPanel = "penny-work"`, sub-tab param `pennySub`, default panel for Penny changes from `info` → `penny-work`.

## Key files

- **Routing and header chrome:** `web/app/CommandCentralClient.tsx` (`RightPanel`, header buttons, which component mounts for each agent).
- **Friday throughput goals:** `web/lib/workflow-types.ts` (`throughputGoal` on a workflow type) · `web/app/api/crm/workflow-throughput/route.ts` · `web/components/friday/FridayGoalsPanel.tsx`
- **Agent metadata (name, role, color, capabilities):** `web/lib/agent-registry.ts` and `web/lib/agent-frontend.ts` (`agentHasKanban`, etc.).
- **Example multi-tab work panels:**  
  `web/components/friday/FridayDashboardPanel.tsx`  
  `web/components/friday/FridayPackageAdminPanel.tsx` (content for Queue / Planner / template tabs)  
  `web/components/tim/TimAgentPanel.tsx`  
  `web/components/suzi/SuziRemindersPanel.tsx` (or equivalent Suzi panel path in repo)  
  `web/components/penny/PennyWorkPanel.tsx` (planned — Clients, Pipeline, Health, Products)
- **Penny workspace design:** `docs/PENNY-PACKAGE-SALES-PLAN.md`

## Deep links

Query params such as `?agent=friday&panel=…` map to `RightPanel` where supported. For example, `panel=dashboard` or `panel=goals` → **Goals** tab; legacy `panel=tasks` opens the Friday dashboard on **Queue** (no separate human-tasks tab); `panel=tools` → **Tools**; `panel=pkg-templates` / `panel=package-templates` → **Package templates**; `panel=wf-templates` / `panel=workflow-templates` → **Workflow templates**; `panel=workflow-manager` (legacy), `panel=workflows`, legacy `panel=observation`, `panel=pipelines`, or `panel=packages` → **Queue**; `panel=planner` → **Planner**. Legacy **`?agent=penny&panel=dashboard`** switches to **Friday** with the **Planner** tab. **`?fridayLab=1`** opens **Friday** on the **Queue** tab. If both lab flags are present, **Tim lab takes precedence**.

For **Suzi**, `?agent=suzi&panel=reminders&suziSub=intake` opens the work panel and selects the **Intake** sub-tab (e.g. after PWA share redirect).

`?panel=knowledge` (with any agent) opens the **book** knowledge panel for that agent (replaces the old Marni-only deep link that opened the work panel on a Knowledge tab).

---

*Keep this document aligned with `CommandCentralClient` when you change defaults or add agents.*
