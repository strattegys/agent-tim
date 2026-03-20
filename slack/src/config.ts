export interface SlackAgentConfig {
  agentId: string;
  botToken: string;
  appToken: string;
  signingSecret: string;
}

const AGENTS = ["tim", "scout", "suzi", "rainbow", "friday"] as const;
export type AgentId = (typeof AGENTS)[number];

export function getSlackAgentConfigs(): SlackAgentConfig[] {
  const configs: SlackAgentConfig[] = [];

  for (const id of AGENTS) {
    const upper = id.toUpperCase();
    const botToken = process.env[`SLACK_${upper}_BOT_TOKEN`];
    const appToken = process.env[`SLACK_${upper}_APP_TOKEN`];
    const signingSecret = process.env[`SLACK_${upper}_SIGNING_SECRET`] || process.env.SLACK_SIGNING_SECRET || "not-used-in-socket-mode";

    if (botToken && appToken) {
      configs.push({ agentId: id, botToken, appToken, signingSecret });
    } else {
      console.warn(`[config] Skipping ${id} — missing SLACK_${upper}_BOT_TOKEN or SLACK_${upper}_APP_TOKEN`);
    }
  }

  return configs;
}

export function getChannelId(name: "alerts" | "ops" | "research" | "linkedin"): string | undefined {
  const map: Record<string, string | undefined> = {
    alerts: process.env.SLACK_ALERTS_CHANNEL,
    ops: process.env.SLACK_OPS_CHANNEL,
    research: process.env.SLACK_RESEARCH_CHANNEL,
    linkedin: process.env.SLACK_LINKEDIN_CHANNEL,
  };
  return map[name];
}
