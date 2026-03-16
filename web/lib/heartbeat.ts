import { readFileSync, existsSync, appendFileSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { readMemory } from "./memory";
import { getAgentConfig } from "./agent-config";
import { getPendingTasks, getCompletedTasks, updateTask, acknowledgeTask } from "./tasks";

/**
 * Heartbeat System — Autonomous Agent Task Checking
 *
 * Every 30 minutes, Tim checks for:
 * 1. Unactioned LinkedIn alerts (inbound messages not yet responded to)
 * 2. Memory-based reminders (follow-ups, tasks with dates)
 * 3. Failed scheduled messages
 * 4. Campaign health (stale contacts, inactive campaigns)
 *
 * Findings are delivered via:
 * - Notification bell (web_notifications.jsonl)
 * - Proactive chat message in Tim's session
 */

const NOTIFICATIONS_FILE = "/root/.nanobot/web_notifications.jsonl";
const TOOL_SCRIPTS_PATH =
  process.env.TOOL_SCRIPTS_PATH || join(process.cwd(), "..", ".nanobot", "tools");

export interface HeartbeatFinding {
  category: string; // "linkedin" | "reminder" | "schedule" | "campaign"
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
}

// Dedup: track last notification time per category to avoid spam
// Resets on PM2 restart — acceptable since findings are re-evaluated each run
const lastNotifiedAt = new Map<string, number>();
const DEDUP_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

function shouldNotify(category: string): boolean {
  const lastTime = lastNotifiedAt.get(category) || 0;
  return Date.now() - lastTime > DEDUP_COOLDOWN_MS;
}

function markNotified(category: string): void {
  lastNotifiedAt.set(category, Date.now());
}

function writeNotification(title: string, message: string): void {
  try {
    const entry = JSON.stringify({
      type: "heartbeat",
      title,
      message,
      timestamp: new Date().toISOString(),
      read: false,
    });
    appendFileSync(NOTIFICATIONS_FILE, entry + "\n");
  } catch (error) {
    console.error("[heartbeat] Failed to write notification:", error);
  }
}

/**
 * Check 1: Unactioned LinkedIn alerts
 *
 * Reads web_notifications.jsonl for recent linkedin-type notifications.
 * Reads Tim's session to see if user has responded to them.
 * If inbound LinkedIn messages exist with no user response after them → finding.
 */
function checkLinkedInAlerts(): HeartbeatFinding[] {
  const findings: HeartbeatFinding[] = [];

  try {
    if (!existsSync(NOTIFICATIONS_FILE)) return findings;

    const raw = readFileSync(NOTIFICATIONS_FILE, "utf-8").trim();
    if (!raw) return findings;

    const lines = raw.split("\n");
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;

    // Find recent LinkedIn inbound notifications (last 2 hours)
    const recentLinkedIn = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(
        (n) =>
          n &&
          (n.type === "linkedin_inbound" || n.type === "linkedin") &&
          n.timestamp &&
          Date.parse(n.timestamp) > twoHoursAgo
      );

    if (recentLinkedIn.length === 0) return findings;

    // Check Tim's session for user messages after the LinkedIn alerts
    const config = getAgentConfig("tim");
    if (!existsSync(config.sessionFile)) {
      // No session = user hasn't responded
      findings.push({
        category: "linkedin",
        title: "Unread LinkedIn Messages",
        detail: `You have ${recentLinkedIn.length} LinkedIn message(s) from the last 2 hours that you haven't responded to yet.`,
        priority: "high",
      });
      return findings;
    }

    const sessionRaw = readFileSync(config.sessionFile, "utf-8").trim();
    const sessionLines = sessionRaw.split("\n");

    // Find the timestamp of the last user message
    let lastUserMsgTime = 0;
    for (let i = sessionLines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(sessionLines[i]);
        if (entry.role === "user" && entry.timestamp) {
          lastUserMsgTime = new Date(entry.timestamp).getTime();
          break;
        }
      } catch {
        continue;
      }
    }

    // If last user message is older than the oldest unactioned alert, flag it
    const oldestAlertTime = Math.min(
      ...recentLinkedIn.map((n: { timestamp: string }) => Date.parse(n.timestamp))
    );
    if (lastUserMsgTime < oldestAlertTime) {
      findings.push({
        category: "linkedin",
        title: "Unread LinkedIn Messages",
        detail: `You have ${recentLinkedIn.length} LinkedIn message(s) awaiting your reply decision.`,
        priority: "high",
      });
    }
  } catch (error) {
    console.error("[heartbeat] LinkedIn check error:", error);
  }

  return findings;
}

/**
 * Check 2: Memory-based reminders
 *
 * Scans MEMORY.md for lines containing date/time patterns like:
 * - "follow up with X on March 17"
 * - "remind me to ... by Friday"
 * - "TODO: ..."
 * - Lines with dates that match today or are past due
 */
function checkReminders(): HeartbeatFinding[] {
  const findings: HeartbeatFinding[] = [];

  try {
    const memory = readMemory("tim");
    if (!memory) return findings;

    const now = new Date();
    const pacificDate = now.toLocaleDateString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "long",
      day: "numeric",
    });
    const pacificDateShort = now.toLocaleDateString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
    });
    const dayOfWeek = now.toLocaleDateString("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "long",
    });

    const lines = memory.split("\n");
    const reminderKeywords = [
      "follow up",
      "follow-up",
      "remind",
      "todo",
      "to-do",
      "deadline",
      "due",
      "by end of",
      "schedule",
      "check back",
      "reach out",
    ];

    const dueReminders: string[] = [];

    for (const line of lines) {
      const lower = line.toLowerCase();

      // Check if line contains reminder keywords
      const isReminder = reminderKeywords.some((kw) => lower.includes(kw));
      if (!isReminder) continue;

      // Check if line mentions today's date or day
      const mentionsToday =
        lower.includes(pacificDate.toLowerCase()) ||
        lower.includes(pacificDateShort.toLowerCase()) ||
        lower.includes(dayOfWeek.toLowerCase()) ||
        lower.includes("today") ||
        lower.includes("asap");

      if (mentionsToday) {
        dueReminders.push(line.trim().replace(/^-\s*/, ""));
      }
    }

    if (dueReminders.length > 0) {
      findings.push({
        category: "reminder",
        title: "Due Reminders",
        detail: dueReminders.join("\n"),
        priority: "medium",
      });
    }
  } catch (error) {
    console.error("[heartbeat] Reminder check error:", error);
  }

  return findings;
}

/**
 * Check 3: Failed scheduled messages
 *
 * Calls scheduled_messages.py list to check for messages that should
 * have been sent but have a "failed" status.
 */
function checkScheduledMessages(): HeartbeatFinding[] {
  const findings: HeartbeatFinding[] = [];

  try {
    const result = execFileSync(
      "python3",
      [join(TOOL_SCRIPTS_PATH, "scheduled_messages.py"), "list"],
      { timeout: 15000, encoding: "utf-8" }
    );

    if (!result || result.includes("No scheduled messages")) return findings;

    // Check for failed or overdue entries
    const lines = result.split("\n");
    const failedMessages: string[] = [];
    const overdueMessages: string[] = [];

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes("failed") || lower.includes("error")) {
        failedMessages.push(line.trim());
      }
      // Check for messages past their send_at time that are still pending
      const timeMatch = line.match(/send_at:\s*(\d{4}-\d{2}-\d{2}T[\d:.+-]+)/);
      if (timeMatch && lower.includes("pending")) {
        const sendAt = Date.parse(timeMatch[1]);
        if (sendAt && sendAt < Date.now()) {
          overdueMessages.push(line.trim());
        }
      }
    }

    if (failedMessages.length > 0) {
      findings.push({
        category: "schedule",
        title: "Failed Scheduled Messages",
        detail: `${failedMessages.length} message(s) failed to send:\n${failedMessages.join("\n")}`,
        priority: "high",
      });
    }

    if (overdueMessages.length > 0) {
      findings.push({
        category: "schedule",
        title: "Overdue Scheduled Messages",
        detail: `${overdueMessages.length} message(s) are past their scheduled time but still pending`,
        priority: "medium",
      });
    }
  } catch (error) {
    console.error("[heartbeat] Schedule check error:", error);
  }

  return findings;
}

/**
 * Check 4: Campaign health
 *
 * Uses CRM tool to check:
 * - Active campaigns with no recent activity
 * - Campaign members not contacted in 7+ days
 */
function checkCampaignHealth(): HeartbeatFinding[] {
  const findings: HeartbeatFinding[] = [];

  try {
    // List campaigns
    const result = execFileSync(
      join(TOOL_SCRIPTS_PATH, "twenty_crm_enhanced.sh"),
      ["list-campaigns"],
      {
        timeout: 15000,
        encoding: "utf-8",
        env: {
          ...process.env,
          TWENTY_CRM_API_KEY: process.env.TWENTY_CRM_API_KEY,
          TWENTY_CRM_URL: process.env.TWENTY_CRM_URL || "http://localhost:3000",
        },
      }
    );

    if (!result || result.includes("No campaigns")) return findings;

    // Parse campaign IDs from output
    const campaignIds: string[] = [];
    const idMatches = result.matchAll(/id[:\s]+([a-f0-9-]{36})/gi);
    for (const match of idMatches) {
      campaignIds.push(match[1]);
    }

    // For each campaign, check member count
    for (const campaignId of campaignIds.slice(0, 3)) {
      // limit to 3 to avoid timeout
      try {
        const members = execFileSync(
          join(TOOL_SCRIPTS_PATH, "twenty_crm_enhanced.sh"),
          ["list-campaign-members", campaignId],
          {
            timeout: 15000,
            encoding: "utf-8",
            env: {
              ...process.env,
              TWENTY_CRM_API_KEY: process.env.TWENTY_CRM_API_KEY,
              TWENTY_CRM_URL:
                process.env.TWENTY_CRM_URL || "http://localhost:3000",
            },
          }
        );

        if (members.includes("0 members") || members.includes("No members")) {
          findings.push({
            category: "campaign",
            title: "Empty Campaign",
            detail: `Campaign ${campaignId.slice(0, 8)} has no enrolled members`,
            priority: "low",
          });
        }
      } catch {
        // Skip individual campaign check errors
      }
    }
  } catch (error) {
    console.error("[heartbeat] Campaign check error:", error);
  }

  return findings;
}

/**
 * Check 5: Completed delegated tasks
 *
 * Looks for tasks that Tim delegated to other agents (e.g., scout)
 * that have been completed and not yet acknowledged.
 */
function checkCompletedTasks(): HeartbeatFinding[] {
  const findings: HeartbeatFinding[] = [];

  try {
    const completed = getCompletedTasks("tim");
    for (const task of completed) {
      const resultPreview = task.result
        ? task.result.length > 200
          ? task.result.slice(0, 200) + "..."
          : task.result
        : "No result returned";

      findings.push({
        category: "delegation",
        title: `Research Complete: ${task.task.slice(0, 60)}`,
        detail: resultPreview,
        priority: "high",
      });

      // Mark as acknowledged so it's not re-processed
      acknowledgeTask(task.id);
    }
  } catch (error) {
    console.error("[heartbeat] Delegation check error:", error);
  }

  return findings;
}

/**
 * Build the autonomous prompt from findings for LLM execution.
 */
function buildAutonomousPrompt(findings: HeartbeatFinding[]): string {
  const findingLines = findings.map(
    (f) => `- [${f.priority.toUpperCase()}] ${f.title}: ${f.detail.split("\n")[0]}`
  );

  return `[AUTONOMOUS HEARTBEAT]

Your heartbeat system detected the following action items:

${findingLines.join("\n")}

Review each finding and take helpful actions:
- Check CRM for relevant context on any people or companies mentioned (use twenty_crm tool)
- Save important observations to memory for future reference
- Draft follow-up messages but do NOT send them — present them for user approval
- Update CRM notes if you find relevant context

IMPORTANT: Do NOT send any LinkedIn messages or connection requests. Do NOT schedule any messages. Only draft them and present for user approval.

Summarize what you found, what actions you took, and recommend next steps.`;
}

/**
 * Main heartbeat runner for Tim.
 * Runs all checks, deduplicates, and delivers findings.
 * When detectOnly=true, returns findings without LLM execution.
 * When detectOnly=false (default), runs autonomous LLM execution with tools.
 */
export async function runTimHeartbeat(
  detectOnly = false
): Promise<HeartbeatFinding[]> {
  console.log("[heartbeat] Tim heartbeat starting...");

  const allFindings: HeartbeatFinding[] = [
    ...checkLinkedInAlerts(),
    ...checkReminders(),
    ...checkScheduledMessages(),
    ...checkCampaignHealth(),
    ...checkCompletedTasks(),
  ];

  if (allFindings.length === 0) {
    console.log("[heartbeat] Tim heartbeat OK — no action items");
    return [];
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  allFindings.sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );

  // Filter to only findings whose category hasn't been notified recently
  const newFindings = allFindings.filter((f) => shouldNotify(f.category));

  if (newFindings.length === 0) {
    console.log(
      `[heartbeat] Tim found ${allFindings.length} item(s) but all were recently notified — skipping`
    );
    return allFindings;
  }

  console.log(
    `[heartbeat] Tim found ${allFindings.length} item(s), notifying ${newFindings.length} new`
  );

  // Mark categories as notified
  for (const f of newFindings) {
    markNotified(f.category);
  }

  if (detectOnly) {
    console.log("[heartbeat] Detect-only mode — skipping LLM execution");
    return allFindings;
  }

  // Phase 2: Autonomous LLM execution
  // Tim reasons about findings using his full tool set
  console.log("[heartbeat] Starting autonomous LLM execution...");

  try {
    const { autonomousChat } = await import("./gemini");
    const prompt = buildAutonomousPrompt(newFindings);
    const response = await autonomousChat("tim", prompt);

    if (response) {
      console.log("[heartbeat] Autonomous execution complete, response saved to session");

      // Write summary to notification bell
      const summaryLine = response.length > 200
        ? response.slice(0, 200) + "..."
        : response;
      writeNotification(
        `Tim Heartbeat — ${newFindings.length} item(s) actioned`,
        summaryLine
      );
    } else {
      console.log("[heartbeat] Autonomous execution returned empty response");
    }
  } catch (error) {
    console.error("[heartbeat] Autonomous execution failed:", error);

    // Fallback: write static notification so findings aren't lost
    const notifLines = newFindings.map(
      (f) => `[${f.priority.toUpperCase()}] ${f.title}: ${f.detail.split("\n")[0]}`
    );
    writeNotification(
      `Tim Heartbeat — ${newFindings.length} item(s)`,
      notifLines.join(" | ")
    );
  }

  return allFindings;
}

/**
 * Simple heartbeat for non-Tim agents.
 * Just logs OK and could be extended later.
 */
export async function runSimpleHeartbeat(agentId: string): Promise<void> {
  console.log(`[heartbeat] ${agentId} heartbeat OK`);
}

/**
 * Scout agent heartbeat.
 * Picks up pending tasks delegated from other agents,
 * processes them via autonomousChat, and writes results back.
 */
export async function runScoutHeartbeat(): Promise<void> {
  const pending = getPendingTasks("scout");

  if (pending.length === 0) {
    console.log("[heartbeat] Scout OK — no pending tasks");
    return;
  }

  console.log(
    `[heartbeat] Scout processing ${pending.length} task(s)`
  );

  const { autonomousChat } = await import("./gemini");

  for (const task of pending) {
    try {
      updateTask(task.id, { status: "in_progress" });
      console.log(`[heartbeat] Scout working on: ${task.task.slice(0, 80)}`);

      const result = await autonomousChat("scout", task.task, { fromAgent: task.from });

      updateTask(task.id, {
        status: "completed",
        result: result || "Scout completed but returned no findings.",
        completedAt: new Date().toISOString(),
      });

      console.log(`[heartbeat] Scout completed task ${task.id}`);

      // Notify the requesting agent
      writeNotification(
        `Scout Complete for ${task.from}`,
        `Task: ${task.task.slice(0, 100)}...`
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[heartbeat] Scout task ${task.id} failed:`, errMsg);

      updateTask(task.id, {
        status: "failed",
        result: `Error: ${errMsg}`,
        completedAt: new Date().toISOString(),
      });
    }
  }
}
