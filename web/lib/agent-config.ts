export interface AgentBackendConfig {
  id: string;
  sessionFile: string;
  systemPromptFile: string;
  tools: string[]; // tool names available to this agent
}

const AGENTS: Record<string, AgentBackendConfig> = {
  tim: {
    id: "tim",
    sessionFile: "/mnt/gdrive/sessions/telegram_5289013326.jsonl",
    systemPromptFile: "/root/.nanobot/system-prompt.md",
    tools: ["twenty_crm", "linkedin", "web_search"],
  },
  suzi: {
    id: "suzi",
    sessionFile: "/root/.suzibot/workspace/sessions/telegram_5289013326.jsonl",
    systemPromptFile: "/root/.suzibot/system-prompt.md",
    tools: ["web_search"],
  },
  ava: {
    id: "ava",
    sessionFile: "/root/.avabot/sessions/web_govind.jsonl",
    systemPromptFile: "/root/.avabot/system-prompt.md",
    tools: ["web_search"],
  },
};

export function getAgentConfig(agentId: string): AgentBackendConfig {
  return AGENTS[agentId] || AGENTS.tim;
}
