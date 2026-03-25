/**
 * Unified Agent Specification Types
 *
 * Single source of truth for what an agent is, what it can do,
 * and how it fits into the Strattegys Command Central system.
 *
 * All other config (backend, frontend, cron) derives from AgentSpec.
 */

// ─── Tool IDs (exhaustive union of available tools) ───

export type ToolId =
  | "twenty_crm"
  | "linkedin"
  | "schedule_message"
  | "web_search"
  | "memory"
  | "agent_manager"
  | "delegate_task"
  | "workflow_items"
  | "reminders"
  | "workflow_manager"
  | "package_manager"
  | "punch_list"
  | "notes"
  | "publish_article"
  | "article_builder";

// ─── Agent Categories ───

export type AgentCategory = "Utility" | "MarkOps" | "ContentOps" | "FinOps" | "Toys";

export const AGENT_CATEGORIES = ["Utility", "MarkOps", "ContentOps", "FinOps", "Toys"] as const;

// ─── Connection descriptor ───

export interface ConnectionSpec {
  /** Human-readable label shown in the UI (e.g., "CRM", "LinkedIn") */
  label: string;
  /** Whether this integration is currently active */
  connected: boolean;
  /** The tool ID that powers this connection (if any) */
  toolId?: ToolId;
}

// ─── Routine / Cron Job descriptor ───

export interface RoutineSpec {
  /** Unique ID for this cron job (used in cron registry) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Cron expression (e.g., "every 15 min" or "0 2 * * *") */
  schedule: string;
  /** What this routine does */
  description: string;
  /**
   * Handler key — maps to a known function in the cron handler factory.
   * E.g., "linkedin-extractor", "scheduled-messages-process", "crm-backup", "linkedin-connections"
   */
  handler: string;
  /** Optional log file path on server */
  logFile?: string;
  /** Whether this routine is active. Defaults to true. */
  enabled?: boolean;
}

// ─── Heartbeat spec ───

export interface HeartbeatCheck {
  name: string;
  description: string;
  priority: "high" | "medium" | "low";
}

export interface HeartbeatSpec {
  /** Heartbeat type determines which runner to use */
  type: "full" | "simple" | "scout";
  /** Cron schedule for the heartbeat */
  schedule: string;
  /** What the heartbeat checks for (displayed in Agent Inspector) */
  checks: HeartbeatCheck[];
}

// ─── Delegation spec ───

export interface DelegationSpec {
  /** Agent IDs this agent can delegate tasks to */
  canDelegateTo: string[];
  /** Task types this agent accepts from others */
  acceptsTaskTypes: string[];
}

// ─── The unified Agent Specification ───

export interface AgentSpec {
  // ── Identity ──
  /** Unique agent ID (e.g., "tim", "scout") */
  id: string;
  /** Display name */
  name: string;
  /** One-line role description */
  role: string;
  /** Extended description — what this agent does and how it fits in */
  description: string;
  /** Category for sidebar grouping */
  category: AgentCategory;

  // ── Visual ──
  /** Hex color for avatar ring, accent, etc. */
  color: string;
  /** Path to avatar image (relative to /public) */
  avatar?: string;

  // ── Technical Config ──
  /** LLM model override. Omit to use default "gemini-2.5-flash". */
  modelName?: string;
  /** Temperature for LLM calls. Lower = more deterministic tool use. Default 0.7. */
  temperature?: number;
  /** Absolute path to JSONL session file on server */
  sessionFile: string;
  /** Absolute path to system prompt markdown on server */
  systemPromptFile: string;
  /** Absolute path to memory directory on server */
  memoryDir: string;

  // ── Capabilities ──
  /** Tool IDs this agent has access to (enforced at runtime) */
  tools: ToolId[];
  /** Human-readable capability labels for UI display */
  capabilities: string[];

  // ── Connections ──
  /** External system integrations */
  connections: ConnectionSpec[];

  // ── Background ──
  /** Background cron jobs this agent owns */
  routines: RoutineSpec[];
  /** Heartbeat configuration (null = no heartbeat) */
  heartbeat: HeartbeatSpec | null;

  // ── Workflows ──
  /**
   * Workflow type IDs this agent owns/operates.
   * References entries in the WORKFLOW_TYPES registry.
   * Empty array = agent has no kanban view.
   */
  workflowTypes: string[];

  // ── Voice ──
  /** Inworld `voiceId` for `/api/tts`. If set, agent responses are spoken aloud. */
  ttsVoice?: string;

  // ── Memory ──
  /** If true, use pgvector-based semantic memory instead of flat MEMORY.md */
  vectorMemory?: boolean;

  // ── Provider ──
  /** LLM provider: "gemini" (default) or "anthropic" */
  provider?: "gemini" | "anthropic" | "groq";

  // ── Delegation ──
  /** Inter-agent delegation configuration */
  delegation: DelegationSpec;
}
