import "server-only";

import { schedule, type ScheduledTask } from "node-cron";
import { pushWorkflowObservabilityEvent } from "./workflow-observability-buffer";
import { execFile } from "child_process";
import { appendFileSync, existsSync } from "fs";
import { AGENT_REGISTRY } from "./agent-registry";
import { crmResolvedHostPort } from "./db";
import type { RoutineSpec, HeartbeatSpec } from "./agent-spec";
import {
  drainUnipileWebhookInbox,
  isUnipileWebhookInboxEnabled,
} from "./unipile-webhook-inbox";
import { isLinkedInAutomationDisabled } from "./linkedin-automation-gate";
import { getLocalRuntimeLabel } from "./app-brand";

/**
 * In-App Cron Scheduler
 *
 * Data-driven from the Agent Registry. Jobs are registered on server startup
 * via GET /api/health (client CronWarmup), /api/chat/stream, and optionally other API routes. Live status: /api/cron-status.
 *
 * **Hosted production only:** scheduled jobs that touch CRM / Unipile / discovery do not run on
 * LOCALDEV, LOCALPROD, or `next dev` — only on the DigitalOcean-deployed app (no local runtime label,
 * NODE_ENV=production). Laptop stacks still use the DB for UI/API; they do not run background crons.
 */

/** True only on the hosted droplet stack (or when CC_FORCE_SERVER_CRON=1). */
export function serverCronsAllowed(): boolean {
  if (process.env.CC_FORCE_SERVER_CRON?.trim() === "1") return true;
  if (process.env.CC_DISABLE_SERVER_CRON?.trim() === "1") return false;
  if (getLocalRuntimeLabel() !== null) return false;
  if (process.env.NODE_ENV === "development") return false;
  return true;
}

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
  /** Mirrors serverCronsAllowed() after each initCronJobs — drives node-cron scheduling. */
  __cronScheduleEnabled?: boolean;
  /** Enables starting timers on a later initCronJobs after CC_FORCE_SERVER_CRON=1 (first init may have run without it). */
  __cronJobHandlers?: Map<string, () => Promise<void>>;
};

const jobRegistry = globalForCron.__cronJobRegistry ?? new Map<string, CronJobConfig>();
globalForCron.__cronJobRegistry = jobRegistry;

const scheduledTasks = globalForCron.__cronScheduledTasks ?? new Map<string, ScheduledTask>();
globalForCron.__cronScheduledTasks = scheduledTasks;

function cronTraceDbDiag(): string {
  try {
    const { host, port } = crmResolvedHostPort();
    const bundled = process.env.CC_BUNDLED_CRM_SERVICE ?? "unset";
    const stack = process.env.CC_RUNTIME_STACK ?? "unset";
    const dockerenv = existsSync("/.dockerenv") ? "1" : "0";
    return `pool→${host}:${port} bundled=${bundled} stack=${stack} .dockerenv=${dockerenv}`;
  } catch {
    return "";
  }
}

/** Avoid flooding the Friday workflow trace buffer (runs every minute). */
const CRON_TRACE_SKIP_IDS = new Set<string>(["unipile-webhook-inbox-drain"]);

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

function attachCronJobTask(job: CronJobConfig, handler: () => Promise<void>): void {
  if (scheduledTasks.has(job.id)) return;

  const cronOpts = job.timeZone ? { timezone: job.timeZone } : undefined;
  const task = schedule(
    job.schedule,
    async () => {
      const startTime = new Date();
      try {
        await handler();
        job.lastRun = startTime;
        job.lastResult = "success";
        logToFile(job.logFile, `[OK] ${job.name} completed`);
        if (!CRON_TRACE_SKIP_IDS.has(job.id)) {
          pushWorkflowObservabilityEvent("cron_job", {
            jobId: job.id,
            name: job.name,
            agentId: job.agentId,
            result: "success",
          });
        }
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : String(error);
        job.lastRun = startTime;
        job.lastResult = `error: ${errMsg.slice(0, 200)}`;
        logToFile(job.logFile, `[ERROR] ${job.name}: ${errMsg}`);
        console.error(`[cron] ${job.name} failed:`, errMsg);
        if (!CRON_TRACE_SKIP_IDS.has(job.id)) {
          let traceErr = errMsg.slice(0, 420);
          if (/ECONNREFUSED|5433/i.test(errMsg)) {
            const diag = cronTraceDbDiag();
            if (diag) traceErr = `${traceErr} | ${diag}`.slice(0, 500);
          }
          pushWorkflowObservabilityEvent("cron_job", {
            jobId: job.id,
            name: job.name,
            agentId: job.agentId,
            result: "error",
            error: traceErr,
          });
        }
      }
    },
    cronOpts
  );

  scheduledTasks.set(job.id, task);
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

  if (!globalForCron.__cronJobHandlers) {
    globalForCron.__cronJobHandlers = new Map();
  }
  globalForCron.__cronJobHandlers.set(config.id, handler);

  if (globalForCron.__cronScheduleEnabled) {
    attachCronJobTask(job, handler);
  }
}

/** Re-read env (CC_FORCE_SERVER_CRON, etc.) and start/stop node-cron tasks. Safe to call on every /api/cron-status hit. */
function reconcileCronSchedulingFromEnv(): void {
  const want = serverCronsAllowed();
  globalForCron.__cronScheduleEnabled = want;

  if (!want) {
    if (scheduledTasks.size > 0) {
      stopAllCrons();
    }
    return;
  }

  let started = 0;
  for (const job of jobRegistry.values()) {
    if (!job.enabled) continue;
    if (scheduledTasks.has(job.id)) continue;
    const h = globalForCron.__cronJobHandlers?.get(job.id);
    if (!h) continue;
    attachCronJobTask(job, h);
    started++;
  }
  if (started > 0) {
    console.log(
      `[cron] Started ${started} scheduled task(s) — CC_FORCE_SERVER_CRON=1 or hosted production.`
    );
  }
}

// ─── Handler factories ───
// Each routine handler string maps to a function that creates the async handler.

type HandlerFactory = (routine: RoutineSpec, agentId: string) => () => Promise<void>;

const ROUTINE_HANDLERS: Record<string, HandlerFactory> = {
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

  "marni-kb-cadence": () => async () => {
    const { processDueKbTopicsCron } = await import("./marni-kb");
    const nMarni = await processDueKbTopicsCron("marni");
    const nTim = await processDueKbTopicsCron("tim");
    const n = nMarni + nTim;
    if (n > 0) {
      console.log(
        `[cron] Knowledge Studio cadence: ran ${n} topic(s) (marni ${nMarni}, tim ${nTim})`
      );
    }
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
    case "friday":
      return async () => {
        const { runFridayHeartbeat } = await import("./heartbeat");
        await runFridayHeartbeat();
      };
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
  if (!globalForCron.__cronJobHandlers) {
    globalForCron.__cronJobHandlers = new Map();
  }

  if (!globalForCron.__cronInitialized) {
    globalForCron.__cronInitialized = true;
    initialized = true;

    globalForCron.__cronScheduleEnabled = serverCronsAllowed();

    if (!globalForCron.__cronScheduleEnabled) {
      console.log(
        "[cron] Registry populated for Friday Cron tab; timers off until CC_FORCE_SERVER_CRON=1 (or use hosted server). " +
          "After setting it in web/.env.local, save and open /api/cron-status or Friday → Cron — timers attach without restarting next dev."
      );
    } else {
      console.log("[cron] Initializing cron jobs...");
    }

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
      agentId: "friday",
      enabled: true,
    },
    async () => {
      const { syncUpcomingHolidays } = await import("./holidays");
      await syncUpcomingHolidays();
    }
  );

  registerJob(
    {
      id: "unipile-webhook-inbox-drain",
      name: "Drain Unipile webhook inbox",
      schedule: "* * * * *",
      description:
        "Process persisted Unipile POST payloads (fault-tolerant queue when app restarts or CRM was down)",
      agentId: "friday",
      enabled: true,
    },
    async () => {
      if (isLinkedInAutomationDisabled()) return;
      if (
        process.env.UNIPILE_WEBHOOK_INBOX_DRAIN_CRON?.trim() === "0" ||
        process.env.UNIPILE_WEBHOOK_INBOX_DRAIN_CRON?.trim().toLowerCase() === "false"
      ) {
        return;
      }
      // Static import — dynamic import() here caused webpack chunk "reading 'call'" failures on the server.
      if (!isUnipileWebhookInboxEnabled()) return;
      const r = await drainUnipileWebhookInbox(50);
      if (r.processed > 0 || r.failed > 0) {
        console.log(
          `[cron] unipile-webhook-inbox-drain: processed=${r.processed} failed=${r.failed} claimed=${r.claimed}`
        );
      }
    }
  );

  registerJob(
    {
      id: "linkedin-inbound-catchup",
      name: "LinkedIn inbound Unipile catch-up",
      schedule: "*/10 * * * *",
      description:
        "Drain webhook inbox batch; release stuck dedupe receipts; replay Unipile DMs (lookback hours from LINKEDIN_INBOUND_CATCHUP_HOURS, default 72)",
      agentId: "friday",
      enabled: true,
    },
    async () => {
      if (isLinkedInAutomationDisabled()) return;
      const { runLinkedInInboundCatchupCron } = await import("./linkedin-inbound-catchup");
      const r = await runLinkedInInboundCatchupCron();
      if (!r.ok) {
        throw new Error(r.replayError || "LinkedIn inbound catch-up failed");
      }
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
      agentId: "friday",
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

  reconcileCronSchedulingFromEnv();
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
