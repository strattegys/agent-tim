/**
 * Agent Registry
 *
 * Single source of truth for all agent specifications.
 * Every other config surface (backend, frontend, cron) derives from this.
 */

import type { AgentSpec } from "./agent-spec";

/** Resolve /root/ paths to AGENT_ROOT when set (for local dev). */
const R = process.env.AGENT_ROOT
  ? (p: string) => p.replace(/^\/root\//, process.env.AGENT_ROOT! + "/")
  : (p: string) => p;

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
    sessionFile: R("/root/.scoutbot/sessions/internal.jsonl"),
    systemPromptFile: R("/root/.scoutbot/system-prompt.md"),
    memoryDir: R("/root/.scoutbot/memory"),
    provider: "groq",
    modelName: "openai/gpt-oss-120b",
    temperature: 0.2,
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
      "Helps Govind work outreach tasks in the Command Central work queue — draft copy, " +
      "CRM context, workflow artifacts. Outbound LinkedIn sends only when Govind clicks " +
      "Submit on a queue item (not via Tim's chat tools). Receives targets from Scout and " +
      "messaging ideas from Marni.",
    category: "MarkOps",
    color: "#1D9E75",
    avatar: "/api/agent-avatar?id=tim",
    sessionFile: R("/root/.nanobot/sessions/web_govind.jsonl"),
    systemPromptFile: R("/root/.nanobot/system-prompt.md"),
    memoryDir: R("/root/.nanobot/memory"),
    provider: "groq",
    modelName: "openai/gpt-oss-120b",
    temperature: 0.2,
    tools: [
      "twenty_crm",
      "web_search",
      "memory",
      "knowledge_search",
      "knowledge_topic_create",
      "delegate_task",
      "workflow_items",
    ],
    capabilities: [
      "Work queue drafts",
      "CRM search",
      "Workflow artifacts",
      "Follow-ups",
      "Knowledge Studio (Tim corpus)",
    ],
    connections: [
      { label: "CRM", connected: true, toolId: "twenty_crm" },
      { label: "Web search", connected: true, toolId: "web_search" },
    ],
    routines: [
      {
        id: "linkedin-sync",
        name: "LinkedIn Message Sync",
        schedule: "*/30 * * * *",
        description:
          "Python extractor — backup/drift catch-up vs webhooks; primary inbound is Unipile → queue",
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
        schedule: "*/30 * * * *",
        description:
          "Polls new connections, CRM note + bell (no LLM); general inbox when not on package path",
        handler: "linkedin-connections",
      },
      {
        id: "warm-outreach-discovery",
        name: "Warm outreach — LinkedIn discovery slots",
        schedule: "*/30 * * * *",
        timeZone: "America/Los_Angeles",
        description:
          "Pacific: :00 & :30, 8:30–16:30 PT. Default: up to N/day + min interval. Package spec warmOutreachDiscovery.pacedDaily: weekdays only, first slot from bootstrap time if empty, next slot after post-intake delay (resolve sets nextEligibleSpawnAt; no LLM)",
        handler: "warm-outreach-discovery",
      },
    ],
    heartbeat: {
      type: "full",
      schedule: "*/30 * * * *",
      checks: [
        {
          name: "Scout delegations",
          description:
            "Bell when Scout research tasks complete for Tim (no LLM in heartbeat)",
          priority: "medium",
        },
        {
          name: "Warm outreach backlog",
          description:
            "Nags when many find-contact (LinkedIn) tasks pile up for an active warm-outreach package",
          priority: "high",
        },
        {
          name: "Warm outreach daily pace",
          description:
            "Medium from 9 a.m. PT, high after 2 p.m., critical after 4 p.m. if intakes remain; bell dedup 2h per category",
          priority: "critical",
        },
      ],
    },
    workflowTypes: ["linkedin-outreach", "warm-outreach"],
    ttsVoice: "Timothy",
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
      "and reminders. Checks reminders every 5 minutes via heartbeat.",
    category: "Utility",
    color: "#D85A30",
    avatar: "/api/agent-avatar?id=suzi",
    sessionFile: R("/root/.suzibot/workspace/sessions/web_govind.jsonl"),
    systemPromptFile: R("/root/.suzibot/system-prompt.md"),
    memoryDir: R("/root/.suzibot/memory"),
    tools: ["web_search", "memory", "reminders", "punch_list", "notes", "intake"],
    capabilities: [
      "Web search",
      "Summaries",
      "Relay messages",
      "Message Susan",
      "Reminders & important dates",
      "Intake captures",
    ],
    connections: [{ label: "Web search", connected: true, toolId: "web_search" }],
    routines: [],
    heartbeat: {
      type: "simple",
      schedule: "*/5 * * * *",
      checks: [
        {
          name: "Reminders",
          description:
            "Loads due reminders from the CRM database and delivers them in chat",
          priority: "high",
        },
      ],
    },
    workflowTypes: [],
    // Inworld voiceId for Suzi read-aloud — keep in sync with production `INWORLD_VOICE_ID` (typically Olivia).
    ttsVoice: "Olivia",
    vectorMemory: true,
    provider: "groq",
    modelName: "openai/gpt-oss-120b",
    temperature: 0.2,
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
      "System prompt updates and backend changes are done in the repo (Cursor) and deployed via CI/CD.",
    category: "Utility",
    color: "#9B59B6",
    avatar: "/api/agent-avatar?id=friday",
    provider: "groq",
    modelName: "openai/gpt-oss-120b",
    temperature: 0.2,
    sessionFile: R("/root/.fridaybot/sessions/web_govind.jsonl"),
    systemPromptFile: R("/root/.fridaybot/system-prompt.md"),
    memoryDir: R("/root/.fridaybot/memory"),
    tools: ["workflow_manager", "web_search", "memory"],
    capabilities: [
      "Monitor packages",
      "Web search",
      "Tool registry",
    ],
    connections: [
      { label: "Packages", connected: true, toolId: "workflow_manager" },
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
    provider: "groq", // article_builder (long-form) still uses Claude in article-builder.ts
    modelName: "openai/gpt-oss-120b",
    temperature: 0.2,
    sessionFile: R("/root/.ghostbot/sessions/web_govind.jsonl"),
    systemPromptFile: R("/root/.ghostbot/system-prompt.md"),
    memoryDir: R("/root/.ghostbot/memory"),
    // Read-aloud (Inworld). Not Olivia/Timothy — change in registry if you prefer another voice.
    ttsVoice: "Avery",
    tools: [
      "web_search",
      "memory",
      "delegate_task",
      "twenty_crm",
      "workflow_items",
      "publish_article",
      "article_builder",
    ],
    capabilities: [
      "Content research",
      "Article generation",
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
    provider: "groq",
    modelName: "openai/gpt-oss-120b",
    temperature: 0.2,
    sessionFile: R("/root/.marnibot/sessions/web_govind.jsonl"),
    systemPromptFile: R("/root/.marnibot/system-prompt.md"),
    memoryDir: R("/root/.marnibot/memory"),
    tools: [
      "web_search",
      "memory",
      "knowledge_search",
      "knowledge_topic_create",
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
      "Knowledge Studio (playbook RAG)",
    ],
    connections: [
      { label: "LinkedIn", connected: true, toolId: "linkedin" },
      { label: "CRM", connected: true, toolId: "twenty_crm" },
      { label: "Web search", connected: true, toolId: "web_search" },
    ],
    routines: [
      {
        id: "marni-kb-cadence",
        name: "Knowledge Studio (cadence)",
        schedule: "23 * * * *",
        description:
          "Runs due Knowledge Studio topics for Marni and Tim: web research → chunks when cadenceMinutes elapsed",
        handler: "marni-kb-cadence",
      },
    ],
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
    role: "Chief Success Agent",
    description:
      "Creates service packages from templates, customizes deliverables for clients, " +
      "manages approval workflows, and triggers cross-agent workflow creation on approval.",
    category: "FinOps",
    color: "#E67E22",
    avatar: "/api/agent-avatar?id=penny",
    provider: "groq",
    modelName: "openai/gpt-oss-120b",
    temperature: 0.2,
    sessionFile: R("/root/.pennybot/sessions/web_govind.jsonl"),
    systemPromptFile: R("/root/.pennybot/system-prompt.md"),
    memoryDir: R("/root/.pennybot/memory"),
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
    // Mid slate — readable on sidebar / header vs --bg-secondary (#17212b); old #1A1A2E blended away
    color: "#5a6d7a",
    avatar: "/api/agent-avatar?id=king",
    provider: "groq",
    modelName: "openai/gpt-oss-120b",
    temperature: 0.2,
    sessionFile: R("/root/.kingbot/sessions/web_govind.jsonl"),
    systemPromptFile: R("/root/.kingbot/system-prompt.md"),
    memoryDir: R("/root/.kingbot/memory"),
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

};

/** Get an agent spec by ID. Falls back to Tim if not found. */
export function getAgentSpec(agentId: string): AgentSpec {
  return AGENT_REGISTRY[agentId] || AGENT_REGISTRY.tim;
}

/** Get all agent specs as an array, ordered for sidebar display. */
export function getAllAgentSpecs(): AgentSpec[] {
  // Sidebar ordering: Utility, MarkOps, ContentOps, FinOps
  const order: AgentSpec["category"][] = [
    "Utility",
    "MarkOps",
    "ContentOps",
    "FinOps",
  ];
  return Object.values(AGENT_REGISTRY).sort(
    (a, b) => order.indexOf(a.category) - order.indexOf(b.category)
  );
}
