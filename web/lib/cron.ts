import "server-only";

import { schedule, type ScheduledTask } from "node-cron";
import { execFile } from "child_process";
import { appendFileSync } from "fs";
import { join } from "path";
import { AGENT_REGISTRY } from "./agent-registry";
import type { RoutineSpec, HeartbeatSpec } from "./agent-spec";

/**
 * In-App Cron Scheduler
 *
 * Data-driven from the Agent Registry. Jobs are registered on server startup
 * via GET /api/health (client CronWarmup), /api/chat/stream, and optionally other API routes. Live status: /api/cron-status.
 */

const TOOL_SCRIPTS_PATH =
  process.env.TOOL_SCRIPTS_PATH || join(process.cwd(), "..", ".nanobot", "tools");

export interface CronJobConfig {
  id: string;
  name: string;
  schedule: string;
  description: string;
  logFile?: string;
  agentId: string;
  enabled: boolean;
  /** IANA zone passed to node-cron when set */
  timeZone?: string;
  lastRun?: Date;
  lastResult?: string; // "success" or error message
}

// Use globalThis to share state between cron bootstrap and API routes
// (Turbopack creates separate module instances for each context)
const globalForCron = globalThis as typeof globalThis & {
  __cronJobRegistry?: Map<string, CronJobConfig>;
  __cronScheduledTasks?: Map<string, ScheduledTask>;
  __cronInitialized?: boolean;
};

const jobRegistry = globalForCron.__cronJobRegistry ?? new Map<string, CronJobConfig>();
globalForCron.__cronJobRegistry = jobRegistry;

const scheduledTasks = globalForCron.__cronScheduledTasks ?? new Map<string, ScheduledTask>();
globalForCron.__cronScheduledTasks = scheduledTasks;

let initialized = globalForCron.__cronInitialized ?? false;

function logToFile(logFile: string | undefined, message: string): void {
  if (!logFile) return;
  try {
    const timestamp = new Date().toISOString();
    appendFileSync(logFile, `[${timestamp}] ${message}\n`);
  } catch {
    // ignore log errors
  }
}

function execScript(
  cmd: string,
  args: string[],
  timeoutMs = 120000
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, encoding: "utf-8" }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${err.message}\n${stderr || ""}`));
      } else {
        resolve(stdout || "");
      }
    });
  });
}

function registerJob(
  config: Omit<CronJobConfig, "lastRun" | "lastResult">,
  handler: () => Promise<void>
): void {
  const job: CronJobConfig = {
    ...config,
    lastRun: undefined,
    lastResult: undefined,
  };
  jobRegistry.set(config.id, job);

  if (!config.enabled) return;

  const cronOpts = config.timeZone ? { timezone: config.timeZone } : undefined;
  const task = schedule(
    config.schedule,
    async () => {
      const startTime = new Date();
      try {
        await handler();
        job.lastRun = startTime;
        job.lastResult = "success";
        logToFile(config.logFile, `[OK] ${config.name} completed`);
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : String(error);
        job.lastRun = startTime;
        job.lastResult = `error: ${errMsg.slice(0, 200)}`;
        logToFile(config.logFile, `[ERROR] ${config.name}: ${errMsg}`);
        console.error(`[cron] ${config.name} failed:`, errMsg);
      }
    },
    cronOpts
  );

  scheduledTasks.set(config.id, task);
}

// ─── Handler factories ───
// Each routine handler string maps to a function that creates the async handler.

type HandlerFactory = (routine: RoutineSpec, agentId: string) => () => Promise<void>;

const ROUTINE_HANDLERS: Record<string, HandlerFactory> = {
  "linkedin-extractor": () => async () => {
    await execScript("python3", [
      join(TOOL_SCRIPTS_PATH, "linkedin_extractor.py"),
    ]);
  },

  "scheduled-messages-process": () => async () => {
    await execScript("python3", [
      join(TOOL_SCRIPTS_PATH, "scheduled_messages.py"),
      "process",
    ]);
  },

  "crm-backup": () => async () => {
    try {
      await execScript("bash", ["/root/scripts/backup-twenty.sh"]);
    } catch {
      console.log("[cron] CRM backup script not found or failed");
    }
  },

  "linkedin-connections": () => async () => {
    const { checkNewConnections } = await import("./linkedin-crm");
    const count = await checkNewConnections();
    if (count > 0) {
      console.log(`[cron] Processed ${count} new LinkedIn connection(s)`);
    }
  },

  "warm-outreach-discovery": () => async () => {
    const { runWarmOutreachDiscoveryTick } = await import("./warm-outreach-discovery");
    await runWarmOutreachDiscoveryTick();
  },

  "scout-daily-research": () => async () => {
    const { agentAutonomousChat } = await import("./agent-llm");
    const { query: dbQuery } = await import("./db");

    // Check for DISCOVERED items across Scout's research-pipeline workflows
    const workflows = await dbQuery(
      `SELECT w.id, w.name FROM "_workflow" w
       WHERE w."ownerAgent" = 'scout' AND w.stage = 'ACTIVE' AND w."deletedAt" IS NULL`
    );
    if (workflows.length === 0) {
      console.log("[cron] Scout daily research: no active research-pipeline workflows");
      return;
    }

    const wfIds = workflows.map((w: Record<string, unknown>) => w.id);
    const items = await dbQuery(
      `SELECT wi.id, wi."workflowId",
              p."name" -> 'firstName' ->> 'value' AS first,
              p."name" -> 'lastName' ->> 'value' AS last,
              p."linkedinUrl" ->> 'value' AS linkedin
       FROM "_workflow_item" wi
       LEFT JOIN person p ON p.id = wi."sourceId"
       WHERE wi."workflowId" = ANY($1) AND wi.stage = 'DISCOVERED' AND wi."deletedAt" IS NULL
       LIMIT 10`,
      [wfIds]
    );

    if (items.length === 0) {
      console.log("[cron] Scout daily research: no DISCOVERED targets to process");
      return;
    }

    const targetList = items
      .map(
        (i: Record<string, unknown>) =>
          `- ${i.first || ""} ${i.last || ""} (linkedin: ${i.linkedin || "unknown"}, item id: ${i.id}, workflow: ${i.workflowId})`
      )
      .join("\n");

    const prompt = `[DAILY RESEARCH ROUTINE]

You have ${items.length} target(s) in DISCOVERED stage awaiting research:

${targetList}

For each target:
1. Use linkedin fetch-profile to get their full profile data
2. Use web_search to find recent news about them or their company
3. Evaluate fit against the campaign criteria stored in your memory
4. If qualified: use workflow_items move-item to move them to RESEARCHING, then QUALIFIED
5. If not a fit: use workflow_items move-item to move them to REJECTED
6. For qualified targets: use workflow_items add-person-to-workflow to add them to Tim's active linkedin-outreach workflow at TARGET stage, then move the item to HANDED_OFF

Summarize your findings for each target.`;

    console.log(`[cron] Scout daily research: processing ${items.length} target(s)`);
    await agentAutonomousChat("scout", prompt);
  },
};

// ─── Heartbeat handler factory ───

function createHeartbeatHandler(
  heartbeat: HeartbeatSpec,
  agentId: string
): () => Promise<void> {
  switch (heartbeat.type) {
    case "full":
      return async () => {
        const { runTimHeartbeat } = await import("./heartbeat");
        await runTimHeartbeat();
      };
    case "simple":
      return async () => {
        const { runSimpleHeartbeat } = await import("./heartbeat");
        await runSimpleHeartbeat(agentId);
      };
    case "scout":
      return async () => {
        const { runScoutHeartbeat } = await import("./heartbeat");
        await runScoutHeartbeat();
      };
    default:
      return async () => {
        console.warn(`[cron] Unknown heartbeat type for agent ${agentId}`);
      };
  }
}

/** Initialize all cron jobs. Idempotent; called from server layout and chat stream API (not instrumentation — Edge-safe). */
export function initCronJobs(): void {
  if (initialized) return;
  initialized = true;
  globalForCron.__cronInitialized = true;

  console.log("[cron] Initializing cron jobs...");

  for (const spec of Object.values(AGENT_REGISTRY)) {
    // Register routines
    for (const routine of spec.routines) {
      const factory = ROUTINE_HANDLERS[routine.handler];
      if (!factory) {
        console.warn(
          `[cron] Unknown handler "${routine.handler}" for routine "${routine.id}" (agent: ${spec.id})`
        );
        continue;
      }

      registerJob(
        {
          id: routine.id,
          name: routine.name,
          schedule: routine.schedule,
          description: routine.description,
          logFile: routine.logFile,
          agentId: spec.id,
          enabled: routine.enabled !== false,
          timeZone: routine.timeZone,
        },
        factory(routine, spec.id)
      );
    }

    // Register heartbeat
    if (spec.heartbeat) {
      registerJob(
        {
          id: `heartbeat-${spec.id}`,
          name: "Heartbeat",
          schedule: spec.heartbeat.schedule,
          description: spec.heartbeat.checks
            .map((c) => c.name)
            .join(", "),
          agentId: spec.id,
          enabled: true,
        },
        createHeartbeatHandler(spec.heartbeat, spec.id)
      );
    }
  }

  // Register monthly holiday sync (1st of each month at 3:17 AM)
  registerJob(
    {
      id: "holiday-sync",
      name: "Holiday Sync",
      schedule: "17 3 1 * *",
      description: "Sync US holidays from Nager.Date API into reminders",
      agentId: "suzi",
      enabled: true,
    },
    async () => {
      const { syncUpcomingHolidays } = await import("./holidays");
      await syncUpcomingHolidays();
    }
  );

  const hasAnthropicAdmin = !!process.env.ANTHROPIC_ADMIN_API_KEY?.trim();
  registerJob(
    {
      id: "anthropic-cost-sync",
      name: "Anthropic admin cost sync",
      schedule: "0 6 * * 0",
      description:
        "Pull Anthropic organization cost_report into _usage_event (weekly, UTC)",
      agentId: "king",
      enabled: hasAnthropicAdmin,
    },
    async () => {
      const { syncAnthropicCostReportToUsageEvents } = await import(
        "./anthropic-admin-sync"
      );
      const r = await syncAnthropicCostReportToUsageEvents({ days: 10 });
      if (!r.ok) {
        console.warn("[cron] anthropic-cost-sync:", r.detail);
      }
    }
  );

  console.log(`[cron] Registered ${jobRegistry.size} jobs`);
}

/** Get all cron jobs, optionally filtered by agent */
export function getCronJobs(agentId?: string): CronJobConfig[] {
  const jobs = Array.from(jobRegistry.values());
  if (agentId) {
    return jobs.filter((j) => j.agentId === agentId);
  }
  return jobs;
}

/** Stop all cron jobs (for graceful shutdown) */
export function stopAllCrons(): void {
  for (const task of scheduledTasks.values()) {
    task.stop();
  }
  scheduledTasks.clear();
  console.log("[cron] All cron jobs stopped");
}
