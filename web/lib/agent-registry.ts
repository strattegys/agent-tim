/**
 * Agent Registry
 *
 * Single source of truth for all agent specifications.
 * Every other config surface (backend, frontend, cron) derives from this.
 */

import type { AgentSpec } from "./agent-spec";

export const AGENT_REGISTRY: Record<string, AgentSpec> = {
  tim: {
    id: "tim",
    name: "Tim",
    role: "Marketing & Sales Assistant",
    description:
      "Manages LinkedIn outreach, CRM operations, and sales workflows. " +
      "Can send messages, track prospects through pipelines, schedule follow-ups, " +
      "and delegate research to Scout.",
    category: "MarkOps",
    color: "#1D9E75",
    avatar: "/tim-avatar.png?v=2",
    sessionFile: "/root/.nanobot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.nanobot/system-prompt.md",
    memoryDir: "/root/.nanobot/memory",
    tools: [
      "twenty_crm",
      "linkedin",
      "schedule_message",
      "web_search",
      "memory",
      "delegate_task",
    ],
    capabilities: ["LinkedIn DMs", "CRM search", "Follow-ups", "Workflows"],
    connections: [
      { label: "CRM", connected: true, toolId: "twenty_crm" },
      { label: "LinkedIn", connected: true, toolId: "linkedin" },
      { label: "Web search", connected: true, toolId: "web_search" },
    ],
    routines: [
      {
        id: "linkedin-sync",
        name: "LinkedIn Message Sync",
        schedule: "*/15 * * * *",
        description:
          "Extracts new LinkedIn messages, creates CRM notes, sends alerts",
        handler: "linkedin-extractor",
        logFile: "/root/.nanobot/linkedin_alerts.log",
      },
      {
        id: "scheduled-messages",
        name: "Scheduled Message Processor",
        schedule: "* * * * *",
        description: "Sends due scheduled LinkedIn messages from the queue",
        handler: "scheduled-messages-process",
        logFile: "/root/.nanobot/scheduled_messages.log",
      },
      {
        id: "crm-backup",
        name: "CRM Backup",
        schedule: "0 2 * * *",
        description: "Nightly backup of Twenty CRM database",
        handler: "crm-backup",
        logFile: "/var/log/twenty-backup.log",
      },
      {
        id: "linkedin-connections",
        name: "LinkedIn Connections Check",
        schedule: "*/10 * * * *",
        description:
          "Polls for new LinkedIn connections, enriches CRM contacts",
        handler: "linkedin-connections",
      },
    ],
    heartbeat: {
      type: "full",
      schedule: "*/30 * * * *",
      checks: [
        {
          name: "LinkedIn Alerts",
          description:
            "Flags inbound messages with no user response in last 2 hours",
          priority: "high",
        },
        {
          name: "Memory Reminders",
          description:
            "Scans memory for follow-ups, todos, and deadlines due today",
          priority: "medium",
        },
        {
          name: "Scheduled Messages",
          description:
            "Detects failed or overdue scheduled LinkedIn messages",
          priority: "high",
        },
        {
          name: "Workflow Health",
          description: "Checks for empty or inactive workflows in CRM",
          priority: "low",
        },
      ],
    },
    workflowTypes: ["linkedin-outreach"],
    delegation: {
      canDelegateTo: ["scout"],
      acceptsTaskTypes: [],
    },
  },

  suzi: {
    id: "suzi",
    name: "Suzi",
    role: "Personal Assistant",
    description:
      "Personal assistant handling web searches, summaries, message relays, " +
      "and reminders. Checks reminders every minute via heartbeat.",
    category: "Utility",
    color: "#D85A30",
    avatar: "/suzi-avatar.png",
    sessionFile: "/root/.suzibot/workspace/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.suzibot/system-prompt.md",
    memoryDir: "/root/.suzibot/memory",
    tools: ["web_search", "memory", "reminders"],
    capabilities: [
      "Web search",
      "Summaries",
      "Relay messages",
      "Message Susan",
      "Reminders & important dates",
    ],
    connections: [{ label: "Web search", connected: true, toolId: "web_search" }],
    routines: [],
    heartbeat: {
      type: "simple",
      schedule: "* * * * *",
      checks: [
        {
          name: "Reminders",
          description:
            "Checks memory for reminders with today's date or keywords",
          priority: "high",
        },
      ],
    },
    workflowTypes: [],
    delegation: {
      canDelegateTo: [],
      acceptsTaskTypes: [],
    },
  },

  friday: {
    id: "friday",
    name: "Friday",
    role: "Agent Architect",
    description:
      "Meta-agent that creates and manages other agents. Can read/update system prompts, " +
      "restart services, check agent status, and delegate tasks.",
    category: "Utility",
    color: "#9B59B6",
    modelName: "gemini-2.5-pro",
    sessionFile: "/root/.fridaybot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.fridaybot/system-prompt.md",
    memoryDir: "/root/.fridaybot/memory",
    tools: ["agent_manager", "workflow_manager", "web_search", "memory", "delegate_task"],
    capabilities: [
      "Build agents",
      "Manage prompts",
      "Agent status",
      "Restart services",
      "Manage workflows",
    ],
    connections: [
      { label: "Agent Manager", connected: true, toolId: "agent_manager" },
      { label: "Workflows", connected: true, toolId: "workflow_manager" },
      { label: "Web search", connected: true, toolId: "web_search" },
    ],
    routines: [],
    heartbeat: null,
    workflowTypes: [],
    delegation: {
      canDelegateTo: ["scout", "tim"],
      acceptsTaskTypes: [],
    },
  },

  scout: {
    id: "scout",
    name: "Scout",
    role: "Intelligence & Research",
    description:
      "Web research, company intelligence, contact discovery, and market analysis. " +
      "Works autonomously on tasks delegated by Tim and Friday.",
    category: "MarkOps",
    color: "#2563EB",
    avatar: "/scout-avatar.svg",
    sessionFile: "/root/.scoutbot/sessions/internal.jsonl",
    systemPromptFile: "/root/.scoutbot/system-prompt.md",
    memoryDir: "/root/.scoutbot/memory",
    tools: ["web_search", "twenty_crm", "memory"],
    capabilities: [
      "Web research",
      "Company intel",
      "Contact discovery",
      "Market analysis",
    ],
    connections: [
      { label: "Web search", connected: true, toolId: "web_search" },
      { label: "CRM", connected: true, toolId: "twenty_crm" },
    ],
    routines: [],
    heartbeat: {
      type: "scout",
      schedule: "*/10 * * * *",
      checks: [
        {
          name: "Delegated Tasks",
          description:
            "Processes research tasks queued by other agents",
          priority: "high",
        },
      ],
    },
    workflowTypes: [],
    delegation: {
      canDelegateTo: [],
      acceptsTaskTypes: ["research", "company-intel", "contact-discovery"],
    },
  },

  ghost: {
    id: "ghost",
    name: "Ghost",
    role: "ContentOps",
    description:
      "Content operations agent handling blog posts, copywriting, social content, " +
      "and content strategy. Manages content pipeline workflows.",
    category: "ContentOps",
    color: "#4A90D9",
    modelName: "gemini-2.5-pro",
    sessionFile: "/root/.ghostbot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.ghostbot/system-prompt.md",
    memoryDir: "/root/.ghostbot/memory",
    tools: ["web_search", "kanban", "memory"],
    capabilities: [
      "Blog posts",
      "Copywriting",
      "Social content",
      "Content strategy",
    ],
    connections: [{ label: "Web search", connected: true, toolId: "web_search" }],
    routines: [],
    heartbeat: null,
    workflowTypes: ["content-pipeline"],
    delegation: {
      canDelegateTo: ["marni"],
      acceptsTaskTypes: ["content-creation", "copywriting"],
    },
  },

  marni: {
    id: "marni",
    name: "Marni",
    role: "Content Distribution",
    description:
      "Handles content distribution, post execution, and engagement. " +
      "Distributes content created by Ghost across channels.",
    category: "ContentOps",
    color: "#D4A017",
    avatar: "/marni-avatar.png",
    sessionFile: "/root/.marnibot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.marnibot/system-prompt.md",
    memoryDir: "/root/.marnibot/memory",
    tools: ["web_search", "memory"],
    capabilities: [
      "Content distribution",
      "Post execution",
      "Engagement & commenting",
    ],
    connections: [{ label: "LinkedIn", connected: false }],
    routines: [],
    heartbeat: null,
    workflowTypes: [],
    delegation: {
      canDelegateTo: [],
      acceptsTaskTypes: ["distribution", "posting"],
    },
  },

  rainbow: {
    id: "rainbow",
    name: "Rainbow",
    role: "Abby's Magical AI Friend",
    description:
      "Kid-friendly AI companion for stories, learning, games, and creativity. " +
      "Runs periodic heartbeat for health checks.",
    category: "Toys",
    color: "#534AB7",
    avatar: "/rainbow-avatar.png",
    sessionFile: "/root/.avabot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.avabot/system-prompt.md",
    memoryDir: "/root/.avabot/memory",
    tools: ["web_search", "memory"],
    capabilities: ["Stories", "Learning", "Games", "Creativity"],
    connections: [{ label: "Web search", connected: true, toolId: "web_search" }],
    routines: [],
    heartbeat: {
      type: "simple",
      schedule: "*/30 * * * *",
      checks: [
        {
          name: "Health Check",
          description: "Periodic health check",
          priority: "low",
        },
      ],
    },
    workflowTypes: [],
    delegation: {
      canDelegateTo: [],
      acceptsTaskTypes: [],
    },
  },
};

/** Get an agent spec by ID. Falls back to Tim if not found. */
export function getAgentSpec(agentId: string): AgentSpec {
  return AGENT_REGISTRY[agentId] || AGENT_REGISTRY.tim;
}

/** Get all agent specs as an array, ordered for sidebar display. */
export function getAllAgentSpecs(): AgentSpec[] {
  // Sidebar ordering: Utility, MarkOps, ContentOps, Toys
  const order: AgentSpec["category"][] = [
    "Utility",
    "MarkOps",
    "ContentOps",
    "Toys",
  ];
  return Object.values(AGENT_REGISTRY).sort(
    (a, b) => order.indexOf(a.category) - order.indexOf(b.category)
  );
}
