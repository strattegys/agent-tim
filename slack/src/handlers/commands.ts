import type { App } from "@slack/bolt";
import { readMemory } from "../../../web/lib/memory";
import { getAgentConfig } from "../../../web/lib/agent-config";

const VALID_AGENTS = ["tim", "scout", "suzi", "rainbow", "friday"];

function resolveAgent(text: string): string {
  const arg = text.trim().toLowerCase();
  return VALID_AGENTS.includes(arg) ? arg : "tim";
}

/**
 * Register slash commands on a Bolt app.
 * All commands go through one app (Tim's) to avoid Slack's
 * "only one app can own a command" restriction.
 */
export function registerSlashCommands(app: App): void {
  // /inspect [agent] — show agent config + memory summary
  app.command("/inspect", async ({ command, ack, respond }) => {
    await ack();
    const agentId = resolveAgent(command.text);

    try {
      const config = getAgentConfig(agentId);
      const memory = readMemory(agentId);
      const memoryPreview = memory
        ? memory.slice(0, 1500) + (memory.length > 1500 ? "\n...(truncated)" : "")
        : "No memories saved.";

      await respond({
        response_type: "ephemeral",
        text: [
          `*Agent: ${agentId.charAt(0).toUpperCase() + agentId.slice(1)}*`,
          `Session: \`${config.sessionFile}\``,
          `Prompt: \`${config.systemPromptFile}\``,
          `Memory: \`${config.memoryDir}\``,
          `Tools: ${config.tools.map((t: string) => `\`${t}\``).join(", ")}`,
          "",
          "*Memory Contents:*",
          "```",
          memoryPreview,
          "```",
        ].join("\n"),
      });
    } catch (error) {
      await respond({ text: `:x: Error inspecting ${agentId}: ${error}` });
    }
  });

  // /memory [agent] — show full memory
  app.command("/memory", async ({ command, ack, respond }) => {
    await ack();
    const agentId = resolveAgent(command.text);

    try {
      const memory = readMemory(agentId);
      const display = memory || "No memories saved yet.";

      await respond({
        response_type: "ephemeral",
        text: `*${agentId.charAt(0).toUpperCase() + agentId.slice(1)}'s Memory:*\n\`\`\`\n${display.slice(0, 2900)}\n\`\`\``,
      });
    } catch (error) {
      await respond({ text: `:x: Error reading memory: ${error}` });
    }
  });

  // /heartbeat — trigger Tim's heartbeat manually
  app.command("/heartbeat", async ({ ack, respond }) => {
    await ack();
    await respond({ text: ":heartbeat: Running heartbeat check..." });

    try {
      const { runTimHeartbeat } = await import("../../../web/lib/heartbeat");
      const findings = await runTimHeartbeat(true); // detect only

      if (findings.length === 0) {
        await respond({ text: ":white_check_mark: No actionable findings." });
        return;
      }

      const lines = findings.map(
        (f: { priority: string; title: string; detail: string }) => `${f.priority === "high" ? ":red_circle:" : ":large_orange_circle:"} *[${f.priority.toUpperCase()}] ${f.title}*\n${f.detail}`
      );

      await respond({
        text: `*Heartbeat Findings (${findings.length}):*\n\n${lines.join("\n\n")}`,
      });
    } catch (error) {
      await respond({ text: `:x: Heartbeat error: ${error}` });
    }
  });
}
