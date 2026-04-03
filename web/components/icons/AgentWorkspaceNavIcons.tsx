/**
 * Right-rail “workspace” tab icons — one distinct glyph per agent, same optical frame (18×18, 24 viewBox).
 * Keep semantics aligned with agent-registry roles (not generic duplicates).
 */

const PX = 18;

const svgProps = {
  width: PX,
  height: PX,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

/** Scout — qualify & funnel prospects (targeting → pipeline). */
export function ScoutWorkspaceIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 5h16l-5.5 9h-5L4 5z" />
      <path d="M11 14h2v6.2l-1 .9-1-.9V14z" />
    </svg>
  );
}

/** Marni — push content to multiple channels (share / distribution). */
export function MarniWorkspaceIcon() {
  return (
    <svg {...svgProps}>
      <circle cx="18" cy="5" r="2.2" />
      <circle cx="6" cy="12" r="2.2" />
      <circle cx="18" cy="19" r="2.2" />
      <path d="m8.7 10.5 7.8-4.2M8.7 13.5l7.8 4.2" />
    </svg>
  );
}

/** Friday — work dashboard (goals, package kanban, tools, cron, …). */
export function FridayWorkspaceIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

/** Penny — client service packages (opens Friday dashboard on Package Kanban). */
export function PennyWorkspaceIcon() {
  return (
    <svg {...svgProps}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

/** Tim — outbound messaging & LinkedIn thread work. */
export function TimWorkspaceIcon() {
  return (
    <svg {...svgProps}>
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4 18-5z" />
    </svg>
  );
}

/** Ghost — draft & edit long-form content. */
export function GhostWorkspaceIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

/** King — spend & usage (FinOps). */
export function KingWorkspaceIcon() {
  return (
    <svg {...svgProps}>
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

/** Suzi — calendar, reminders, punch list. */
export function SuziWorkspaceIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

/** Default workflow / Kanban board (pipeline columns). */
export function PipelineKanbanWorkspaceIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="3" width="5" height="18" rx="1" />
      <rect x="10" y="3" width="5" height="12" rx="1" />
      <rect x="17" y="3" width="5" height="8" rx="1" />
    </svg>
  );
}
