/**
 * Agent Registry
 *
 * Single source of truth for all agent specifications.
 * Every other config surface (backend, frontend, cron) derives from this.
 */

import type { AgentSpec } from "./agent-spec";

export const AGENT_REGISTRY: Record<string, AgentSpec> = {
  // ─── MarkOps: Scout before Tim (Scout finds targets, Tim engages) ───

  scout: {
    id: "scout",
    name: "Scout",
    role: "Intelligence & Research",
    description:
      "Finds and qualifies LinkedIn prospects for outreach campaigns. " +
      "Researches targets via LinkedIn profiles and web search, then loads qualified " +
      "prospects into Tim's outreach pipeline.",
    category: "MarkOps",
    color: "#2563EB",
    avatar: "/api/agent-avatar?id=scout",
    sessionFile: "/root/.scoutbot/sessions/internal.jsonl",
    systemPromptFile: "/root/.scoutbot/system-prompt.md",
    memoryDir: "/root/.scoutbot/memory",
    tools: [
      "web_search",
      "twenty_crm",
      "linkedin",
      "memory",
      "delegate_task",
      "workflow_items",
    ],
    capabilities: [
      "Target research",
      "LinkedIn profiling",
      "Company intel",
      "Prospect qualification",
    ],
    connections: [
      { label: "Web search", connected: true, toolId: "web_search" },
      { label: "CRM", connected: true, toolId: "twenty_crm" },
      { label: "LinkedIn", connected: true, toolId: "linkedin" },
    ],
    routines: [
      {
        id: "daily-target-research",
        name: "Daily Target Research",
        schedule: "0 8 * * 1-5",
        description:
          "Process research pipeline: research targets, qualify, load into Tim's outreach",
        handler: "scout-daily-research",
      },
    ],
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
        {
          name: "Research Pipeline",
          description:
            "Checks for unprocessed targets in DISCOVERED stage",
          priority: "medium",
        },
      ],
    },
    workflowTypes: ["research-pipeline"],
    delegation: {
      canDelegateTo: ["tim"],
      acceptsTaskTypes: ["research", "company-intel", "contact-discovery"],
    },
  },

  tim: {
    id: "tim",
    name: "Tim",
    role: "Marketing & Sales Assistant",
    description:
      "Executes LinkedIn outreach — sends connection requests, manages responses, " +
      "schedules follow-ups. Receives qualified targets from Scout and messaging " +
      "content from Marni.",
    category: "MarkOps",
    color: "#1D9E75",
    avatar: "/api/agent-avatar?id=tim",
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
      "workflow_items",
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
      acceptsTaskTypes: ["outreach-target", "messaging-content"],
    },
  },

  // ─── Utility ───

  suzi: {
    id: "suzi",
    name: "Suzi",
    role: "Personal Assistant",
    description:
      "Personal assistant handling web searches, summaries, message relays, " +
      "and reminders. Checks reminders every minute via heartbeat.",
    category: "Utility",
    color: "#D85A30",
    avatar: "/api/agent-avatar?id=suzi",
    sessionFile: "/root/.suzibot/workspace/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.suzibot/system-prompt.md",
    memoryDir: "/root/.suzibot/memory",
    tools: ["web_search", "memory", "reminders", "punch_list"],
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
    ttsVoice: "Zephyr",
    vectorMemory: true,
    modelName: "gemini-2.5-flash",
    delegation: {
      canDelegateTo: [],
      acceptsTaskTypes: [],
    },
  },

  friday: {
    id: "friday",
    name: "Friday",
    role: "Right Hand Robot",
    description:
      "Your right hand robot — manages workflows, monitors tools, and helps coordinate agents. " +
      "System prompt updates and backend changes are handled via Claude Code.",
    category: "Utility",
    color: "#9B59B6",
    avatar: "/api/agent-avatar?id=friday",
    modelName: "gemini-2.5-pro",
    sessionFile: "/root/.fridaybot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.fridaybot/system-prompt.md",
    memoryDir: "/root/.fridaybot/memory",
    tools: ["workflow_manager", "web_search", "memory"],
    capabilities: [
      "Manage workflows",
      "Web search",
      "Tool registry",
    ],
    connections: [
      { label: "Workflows", connected: true, toolId: "workflow_manager" },
      { label: "Web search", connected: true, toolId: "web_search" },
    ],
    routines: [],
    heartbeat: null,
    workflowTypes: [],
    delegation: {
      canDelegateTo: [],
      acceptsTaskTypes: [],
    },
  },

  // ─── ContentOps ───

  ghost: {
    id: "ghost",
    name: "Ghost",
    role: "Content Research & Strategy",
    description:
      "Content researcher and strategist — finds killer ideas, does deep research, " +
      "manages the content pipeline. Feeds published content to Marni for distribution " +
      "and can discover prospects for Scout.",
    category: "ContentOps",
    color: "#4A90D9",
    avatar: "/api/agent-avatar?id=ghost",
    modelName: "gemini-2.5-pro",
    sessionFile: "/root/.ghostbot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.ghostbot/system-prompt.md",
    memoryDir: "/root/.ghostbot/memory",
    tools: [
      "web_search",
      "memory",
      "delegate_task",
      "twenty_crm",
      "workflow_items",
    ],
    capabilities: [
      "Content research",
      "Blog posts",
      "Content strategy",
      "Prospect discovery",
    ],
    connections: [
      { label: "Web search", connected: true, toolId: "web_search" },
      { label: "CRM", connected: true, toolId: "twenty_crm" },
    ],
    routines: [],
    heartbeat: null,
    workflowTypes: ["content-pipeline"],
    delegation: {
      canDelegateTo: ["marni", "scout"],
      acceptsTaskTypes: ["content-creation", "copywriting"],
    },
  },

  marni: {
    id: "marni",
    name: "Marni",
    role: "Content Distribution",
    description:
      "Takes Ghost's published content and creates derivative pieces — LinkedIn posts, " +
      "outreach messaging (fed to Tim), and email content. Manages the distribution pipeline.",
    category: "ContentOps",
    color: "#D4A017",
    avatar: "/api/agent-avatar?id=marni",
    sessionFile: "/root/.marnibot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.marnibot/system-prompt.md",
    memoryDir: "/root/.marnibot/memory",
    tools: [
      "web_search",
      "memory",
      "linkedin",
      "delegate_task",
      "twenty_crm",
      "workflow_items",
    ],
    capabilities: [
      "LinkedIn posts",
      "Outreach messaging",
      "Content repurposing",
      "Email content",
    ],
    connections: [
      { label: "LinkedIn", connected: true, toolId: "linkedin" },
      { label: "CRM", connected: true, toolId: "twenty_crm" },
      { label: "Web search", connected: true, toolId: "web_search" },
    ],
    routines: [],
    heartbeat: null,
    workflowTypes: ["content-distribution"],
    delegation: {
      canDelegateTo: ["tim"],
      acceptsTaskTypes: ["distribution", "posting"],
    },
  },

  // ─── FinOps ───

  penny: {
    id: "penny",
    name: "Penny",
    role: "Package Builder & Client Liaison",
    description:
      "Creates service packages from templates, customizes deliverables for clients, " +
      "manages approval workflows, and triggers cross-agent workflow creation on approval.",
    category: "FinOps",
    color: "#E67E22",
    avatar: "/api/agent-avatar?id=penny",
    sessionFile: "/root/.pennybot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.pennybot/system-prompt.md",
    memoryDir: "/root/.pennybot/memory",
    tools: [
      "package_manager",
      "twenty_crm",
      "web_search",
      "memory",
      "delegate_task",
    ],
    capabilities: [
      "Package building",
      "Client proposals",
      "CRM lookup",
      "Workflow orchestration",
    ],
    connections: [
      { label: "Packages", connected: true, toolId: "package_manager" },
      { label: "CRM", connected: true, toolId: "twenty_crm" },
      { label: "Web search", connected: true, toolId: "web_search" },
    ],
    routines: [],
    heartbeat: null,
    workflowTypes: [],
    delegation: {
      canDelegateTo: ["tim", "scout", "ghost", "marni"],
      acceptsTaskTypes: ["package-request"],
    },
  },

  king: {
    id: "king",
    name: "King",
    role: "Financial Controller",
    description:
      "Handles pricing, invoicing, and financial tracking. " +
      "Currently a placeholder — tools and capabilities coming soon.",
    category: "FinOps",
    color: "#FFFFFF",
    avatar: "/api/agent-avatar?id=king",
    sessionFile: "/root/.kingbot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.kingbot/system-prompt.md",
    memoryDir: "/root/.kingbot/memory",
    tools: ["web_search", "memory"],
    capabilities: ["Pricing (coming soon)", "Invoicing (coming soon)"],
    connections: [
      { label: "Web search", connected: true, toolId: "web_search" },
    ],
    routines: [],
    heartbeat: null,
    workflowTypes: [],
    delegation: {
      canDelegateTo: [],
      acceptsTaskTypes: [],
    },
  },

  // ─── Toys ───

  rainbow: {
    id: "rainbow",
    name: "Rainbow",
    role: "Abby's Magical AI Friend",
    description:
      "Kid-friendly AI companion for stories, learning, games, and creativity. " +
      "Runs periodic heartbeat for health checks.",
    category: "Toys",
    color: "#534AB7",
    avatar: "/api/agent-avatar?id=rainbow",
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
  // Sidebar ordering: Utility, MarkOps, ContentOps, FinOps, Toys
  const order: AgentSpec["category"][] = [
    "Utility",
    "MarkOps",
    "ContentOps",
    "FinOps",
    "Toys",
  ];
  return Object.values(AGENT_REGISTRY).sort(
    (a, b) => order.indexOf(a.category) - order.indexOf(b.category)
  );
}
