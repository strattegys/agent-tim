export interface Routine {
  name: string;
  schedule: string;
  description: string;
  logFile?: string;
}

export interface AgentBackendConfig {
  id: string;
  modelName?: string;
  hasKanban?: boolean;
  sessionFile: string;
  systemPromptFile: string;
  memoryDir: string;
  tools: string[];
  routines: Routine[];
}

const AGENTS: Record<string, AgentBackendConfig> = {
  tim: {
    id: "tim",
    hasKanban: true,
    sessionFile: "/root/.nanobot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.nanobot/system-prompt.md",
    memoryDir: "/root/.nanobot/memory",
    tools: ["twenty_crm", "linkedin", "schedule_message", "web_search", "memory", "delegate_task"],
    routines: [
      {
        name: "LinkedIn Message Sync",
        schedule: "*/15 * * * *",
        description: "Extracts new LinkedIn messages, creates CRM notes, sends alerts",
        logFile: "/root/.nanobot/linkedin_alerts.log",
      },
      {
        name: "Scheduled Message Processor",
        schedule: "* * * * *",
        description: "Sends due scheduled LinkedIn messages from the queue",
        logFile: "/root/.nanobot/scheduled_messages.log",
      },
      {
        name: "CRM Backup",
        schedule: "0 2 * * *",
        description: "Nightly backup of Twenty CRM database",
        logFile: "/var/log/twenty-backup.log",
      },
      {
        name: "LinkedIn Connections Check",
        schedule: "*/10 * * * *",
        description: "Polls for new LinkedIn connections, enriches CRM contacts",
      },
    ],
  },
  suzi: {
    id: "suzi",
    sessionFile: "/root/.suzibot/workspace/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.suzibot/system-prompt.md",
    memoryDir: "/root/.suzibot/memory",
    tools: ["web_search", "memory"],
    routines: [],
  },
  rainbow: {
    id: "rainbow",
    sessionFile: "/root/.avabot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.avabot/system-prompt.md",
    memoryDir: "/root/.avabot/memory",
    tools: ["web_search", "memory"],
    routines: [],
  },
  scout: {
    id: "scout",
    sessionFile: "/root/.scoutbot/sessions/internal.jsonl",
    systemPromptFile: "/root/.scoutbot/system-prompt.md",
    memoryDir: "/root/.scoutbot/memory",
    tools: ["web_search", "twenty_crm", "memory"],
    routines: [],
  },
  friday: {
    id: "friday",
    modelName: "gemini-2.5-pro",
    sessionFile: "/root/.fridaybot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.fridaybot/system-prompt.md",
    memoryDir: "/root/.fridaybot/memory",
    tools: ["agent_manager", "web_search", "memory", "delegate_task"],
    routines: [],
  },
};

export function getAgentConfig(agentId: string): AgentBackendConfig {
  return AGENTS[agentId] || AGENTS.tim;
}

export function agentHasKanban(agentId: string): boolean {
  return AGENTS[agentId]?.hasKanban ?? false;
}
