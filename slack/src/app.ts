import "dotenv/config";
import { App, LogLevel } from "@slack/bolt";
import { getSlackAgentConfigs } from "./config.js";
import { registerMessageHandlers } from "./handlers/message.js";
import { registerApprovalHandlers } from "./handlers/approval.js";
import { registerSlashCommands } from "./handlers/commands.js";
import { startWebhookServer } from "./webhook-server.js";
import { setSlackBotToken } from "./linkedin-inbound.js";
import cron from "node-cron";

interface BotApp {
  agentId: string;
  app: App;
}

const botApps: BotApp[] = [];

async function main() {
  const configs = getSlackAgentConfigs();

  if (configs.length === 0) {
    console.error("[gateway] No agent configs found. Check SLACK_*_BOT_TOKEN and SLACK_*_APP_TOKEN env vars.");
    process.exit(1);
  }

  console.log(`[gateway] Starting ${configs.length} agent(s): ${configs.map((c) => c.agentId).join(", ")}`);

  for (const config of configs) {
    const app = new App({
      token: config.botToken,
      appToken: config.appToken,
      socketMode: true,
      logLevel: LogLevel.DEBUG,
    });

    // Register handlers
    registerMessageHandlers(app, config.agentId);
    registerApprovalHandlers(app, config.agentId);

    // Slash commands only on Tim (primary agent)
    if (config.agentId === "tim") {
      registerSlashCommands(app);
    }

    await app.start();
    console.log(`[gateway] ${config.agentId} is online`);

    botApps.push({ agentId: config.agentId, app });
  }

  // Wire delegation visibility into Slack
  const { setDelegationCallback, setSlackExecutor } = await import("../../web/lib/tools");
  const { onDelegation } = await import("./handlers/delegation.js");
  setDelegationCallback((from: string, to: string, task: string, result: string) => {
    onDelegation(from, to, task, result).catch((err) =>
      console.error("[delegation] Slack post failed:", err)
    );
  });

  // Wire Slack tool executor so agents can proactively use Slack
  const { executeSlackTool } = await import("./slack-tools.js");
  setSlackExecutor(executeSlackTool);

  // Pass Tim's bot token to the LinkedIn inbound handler for Slack alerts
  const timConfig = configs.find((c) => c.agentId === "tim");
  if (timConfig) {
    setSlackBotToken(timConfig.botToken);
  }

  // Start webhook server for Unipile LinkedIn webhooks
  startWebhookServer();

  // Initialize cron jobs
  initCronJobs();

  console.log("[gateway] All agents started. Listening for events...");
}

function initCronJobs() {
  // Tim's heartbeat — every 30 minutes
  cron.schedule("*/30 * * * *", async () => {
    console.log("[cron] Running Tim heartbeat...");
    try {
      const { runTimHeartbeat } = await import("../../web/lib/heartbeat");
      const findings = await runTimHeartbeat(false); // autonomous mode
      if (findings.length > 0) {
        const timApp = botApps.find((b) => b.agentId === "tim");
        if (timApp) {
          const { postHeartbeatFindings } = await import("./notifications.js");
          await postHeartbeatFindings(timApp.app.client, findings, "tim");
        }
      }
      console.log(`[cron] Tim heartbeat done: ${findings.length} finding(s)`);
    } catch (error) {
      console.error("[cron] Tim heartbeat error:", error);
    }
  });

  // Scout's heartbeat — every 10 minutes (processes delegated tasks)
  cron.schedule("*/10 * * * *", async () => {
    console.log("[cron] Running Scout heartbeat...");
    try {
      const { runScoutHeartbeat } = await import("../../web/lib/heartbeat");
      await runScoutHeartbeat();
      console.log("[cron] Scout heartbeat done");
    } catch (error) {
      console.error("[cron] Scout heartbeat error:", error);
    }
  });

  // LinkedIn inbound messages now handled by Unipile webhook (webhook-server.ts)
  // The linkedin_extractor.py cron has been replaced by real-time webhooks.

  // Scheduled message processor — every minute
  cron.schedule("* * * * *", async () => {
    try {
      const { execFileSync } = await import("child_process");
      const toolsPath = process.env.TOOL_SCRIPTS_PATH || "/root/.nanobot/tools";
      execFileSync("python3", [`${toolsPath}/scheduled_messages.py`, "process"], {
        timeout: 30000,
        stdio: "pipe",
      });
    } catch {
      // Silent — most runs have nothing to process
    }
  });

  console.log("[cron] All cron jobs registered");
}

// Export for external access (e.g., delegation handler)
export function getBotApp(agentId: string): BotApp | undefined {
  return botApps.find((b) => b.agentId === agentId);
}

main().catch((error) => {
  console.error("[gateway] Fatal error:", error);
  process.exit(1);
});
