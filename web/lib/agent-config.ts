export interface Routine {
  name: string;
  schedule: string;
  description: string;
  logFile?: string;
}

export interface AgentBackendConfig {
  id: string;
  sessionFile: string;
  systemPromptFile: string;
  tools: string[];
  routines: Routine[];
}

const AGENTS: Record<string, AgentBackendConfig> = {
  tim: {
    id: "tim",
    sessionFile: "/root/.nanobot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.nanobot/system-prompt.md",
    tools: ["twenty_crm", "linkedin", "schedule_message", "web_search"],
    routines: [
      {
        name: "LinkedIn Message Sync",
        schedule: "*/15 * * * *",
        description: "Extracts new LinkedIn messages, creates CRM notes, sends alerts",
        logFile: "/root/.nanobot/linkedin_alerts.log",
      },
      {
        name: "CRM Backup",
        schedule: "0 2 * * *",
        description: "Nightly backup of Twenty CRM database",
        logFile: "/var/log/twenty-backup.log",
      },
    ],
  },
  suzi: {
    id: "suzi",
    sessionFile: "/root/.suzibot/workspace/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.suzibot/system-prompt.md",
    tools: ["web_search"],
    routines: [],
  },
  rainbow: {
    id: "rainbow",
    sessionFile: "/root/.avabot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.avabot/system-prompt.md",
    tools: ["web_search"],
    routines: [],
  },
};

export function getAgentConfig(agentId: string): AgentBackendConfig {
  return AGENTS[agentId] || AGENTS.tim;
}
