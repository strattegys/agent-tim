import { readMemory } from "./memory";
import { getPendingTasks, getCompletedTasks, updateTask, acknowledgeTask } from "./tasks";
import { writeNotification } from "./notifications";
import type { WarmOutreachHeartbeatFinding } from "./warm-outreach-discovery";
import { checkWarmOutreachBacklogFindings } from "./warm-outreach-discovery";
import { checkWarmOutreachDailyPaceFindings } from "./warm-outreach-daily-progress";

/**
 * Tim heartbeat — lightweight ops nudges (no legacy file/shell CRM scans).
 *
 * Uses Postgres-backed warm-outreach checks only. Inbound LinkedIn is handled by
 * Unipile webhooks and the work queue; we do not re-scan notifications.jsonl or
 * run autonomous LLM + CRM tools here (that produced noisy “heartbeat summaries”).
 *
 * Output: notification bell entries only (optional detect-only for /api/heartbeat).
 */

export interface HeartbeatFinding {
  category: string;
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
}

const lastNotifiedAt = new Map<string, number>();
const DEDUP_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

function shouldNotify(category: string): boolean {
  const lastTime = lastNotifiedAt.get(category) || 0;
  return Date.now() - lastTime > DEDUP_COOLDOWN_MS;
}

function markNotified(category: string): void {
  lastNotifiedAt.set(category, Date.now());
}

const BELL_DETAIL_MAX = 900;

/**
 * Scout tasks completed for Tim — bell only, no LLM (acknowledge immediately).
 */
function flushCompletedDelegationsToBell(): void {
  try {
    const completed = getCompletedTasks("tim");
    if (completed.length === 0) return;

    const parts: string[] = [];
    for (const task of completed) {
      acknowledgeTask(task.id);
      const preview = task.result
        ? task.result.length > 220
          ? `${task.result.slice(0, 220)}…`
          : task.result
        : "(no result text)";
      parts.push(`${task.task.slice(0, 72)}${task.task.length > 72 ? "…" : ""} — ${preview}`);
    }

    writeNotification(
      `Scout: ${completed.length} research task(s) ready`,
      parts.join(" \u2022 ").slice(0, BELL_DETAIL_MAX)
    );
  } catch (error) {
    console.error("[heartbeat] Delegation bell error:", error);
  }
}

/**
 * Main heartbeat runner for Tim.
 * Runs all checks, deduplicates, and delivers findings.
 * When detectOnly=true, returns findings without LLM execution.
 * When detectOnly=false (default), runs autonomous LLM execution with tools.
 */
async function checkWarmOutreachBacklogSafe(): Promise<HeartbeatFinding[]> {
  try {
    const raw = await checkWarmOutreachBacklogFindings();
    return raw.map((f: WarmOutreachHeartbeatFinding) => ({
      category: f.category,
      title: f.title,
      detail: f.detail,
      priority: f.priority,
    }));
  } catch (error) {
    console.error("[heartbeat] Warm outreach backlog check failed:", error);
    return [];
  }
}

async function checkWarmOutreachDailyPaceSafe(): Promise<HeartbeatFinding[]> {
  try {
    const raw = await checkWarmOutreachDailyPaceFindings();
    return raw.map((f: WarmOutreachHeartbeatFinding) => ({
      category: f.category,
      title: f.title,
      detail: f.detail,
      priority: f.priority,
    }));
  } catch (error) {
    console.error("[heartbeat] Warm outreach daily pace check failed:", error);
    return [];
  }
}

export async function runTimHeartbeat(
  detectOnly = false
): Promise<HeartbeatFinding[]> {
  console.log("[heartbeat] Tim heartbeat starting...");

  if (!detectOnly) {
    flushCompletedDelegationsToBell();
  }

  const warmBacklog = await checkWarmOutreachBacklogSafe();
  const warmDailyPace = await checkWarmOutreachDailyPaceSafe();

  const allFindings: HeartbeatFinding[] = [...warmBacklog, ...warmDailyPace];

  if (allFindings.length === 0) {
    console.log("[heartbeat] Tim heartbeat OK — no warm-outreach nudges");
    return [];
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  allFindings.sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );

  const newFindings = allFindings.filter((f) => shouldNotify(f.category));

  if (newFindings.length === 0) {
    console.log(
      `[heartbeat] Tim: ${allFindings.length} warm-outreach finding(s) — all recently notified`
    );
    return allFindings;
  }

  console.log(
    `[heartbeat] Tim: ${allFindings.length} finding(s), ${newFindings.length} new bell notification(s)`
  );

  if (detectOnly) {
    return allFindings;
  }

  for (const f of newFindings) {
    markNotified(f.category);
    const body =
      f.detail.length > BELL_DETAIL_MAX
        ? `${f.detail.slice(0, BELL_DETAIL_MAX)}…`
        : f.detail;
    writeNotification(f.title, body);
  }

  return allFindings;
}

// Track which reminders have been delivered to avoid re-firing every minute
const deliveredReminders = new Set<string>();

/**
 * Simple heartbeat for non-Tim agents.
 * For Suzi: checks DB-based reminders. For others: checks memory-based reminders.
 */
export async function runSimpleHeartbeat(agentId: string): Promise<void> {
  if (agentId === "suzi") {
    return runSuziDbHeartbeat();
  }

  // Legacy memory-based reminders for other agents
  const reminders = checkAgentReminders(agentId);

  const newReminders = reminders.filter(
    (r) => !deliveredReminders.has(`${agentId}:${r}`)
  );

  if (newReminders.length === 0) {
    if (reminders.length === 0) {
      console.log(`[heartbeat] ${agentId} heartbeat OK`);
    }
    return;
  }

  console.log(`[heartbeat] ${agentId} found ${newReminders.length} due reminder(s)`);

  for (const r of newReminders) {
    deliveredReminders.add(`${agentId}:${r}`);
  }

  try {
    const { agentAutonomousChat } = await import("./agent-llm");
    const reminderList = newReminders
      .map((r) => `- ${r}`)
      .join("\n");

    const prompt = [
      `[REMINDER DELIVERY]`,
      ``,
      `The following reminders are now due:`,
      ``,
      reminderList,
      ``,
      `Deliver these reminders to Govind in a friendly way. Then mark them as delivered by updating your memory — remove the delivered reminder lines using the memory replace command.`,
    ].join("\n");

    await agentAutonomousChat(agentId, prompt);

    writeNotification(
      `${agentId} Reminders`,
      newReminders.join("; ")
    );
  } catch (err) {
    console.error(`[heartbeat] ${agentId} reminder delivery failed:`, err);
    for (const r of newReminders) {
      deliveredReminders.delete(`${agentId}:${r}`);
    }
  }

  if (deliveredReminders.size > 200) {
    deliveredReminders.clear();
  }
}

/**
 * DB-based heartbeat for Suzi. Checks _reminder table for due items.
 */
async function runSuziDbHeartbeat(): Promise<void> {
  try {
    const { getDueReminders, markDeliveredAndAdvance } = await import("./reminders");
    const due = await getDueReminders("suzi");

    // Filter out already-delivered (dedup for minute-level polling)
    const newDue = due.filter(
      (r) => !deliveredReminders.has(`suzi:${r.id}`)
    );

    if (newDue.length === 0) {
      if (due.length === 0) {
        console.log(`[heartbeat] suzi heartbeat OK`);
      }
      return;
    }

    console.log(`[heartbeat] suzi found ${newDue.length} due reminder(s) from DB`);

    // Mark as delivered in dedup set
    for (const r of newDue) {
      deliveredReminders.add(`suzi:${r.id}`);
    }

    const { agentAutonomousChat } = await import("./agent-llm");
    const reminderList = newDue
      .map((r) => {
        const dueDate = r.nextDueAt
          ? new Date(r.nextDueAt).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })
          : "";
        return `- [${r.category}] ${r.title}${dueDate ? ` (${dueDate})` : ""}${r.description ? `: ${r.description}` : ""}`;
      })
      .join("\n");

    const prompt = [
      `[REMINDER DELIVERY]`,
      ``,
      `The following reminders are now due:`,
      ``,
      reminderList,
      ``,
      `Deliver these reminders to Govind in a friendly, warm way. These have already been automatically marked as delivered in the database — no need to update memory.`,
    ].join("\n");

    await agentAutonomousChat("suzi", prompt);

    // Mark delivered in DB and advance recurring ones
    for (const r of newDue) {
      await markDeliveredAndAdvance(r.id);
    }

    writeNotification(
      "Suzi Reminders",
      newDue.map((r) => r.title).join("; ")
    );
  } catch (err) {
    console.error(`[heartbeat] suzi DB reminder check failed:`, err);
    // Clear dedup entries so they retry
    for (const key of deliveredReminders) {
      if (key.startsWith("suzi:")) deliveredReminders.delete(key);
    }
  }

  if (deliveredReminders.size > 200) {
    deliveredReminders.clear();
  }
}

/**
 * Check an agent's memory for due reminders.
 * Supports formats like:
 *   reminder::2026-03-21T14:00::Call the bank
 *   reminder::active::2026-03-21T14:00:00-07:00::Call the bank
 */
function checkAgentReminders(agentId: string): string[] {
  const memory = readMemory(agentId);
  if (!memory) return [];

  const now = new Date();
  const dueReminders: string[] = [];

  for (const line of memory.split("\n")) {
    const trimmed = line.trim().replace(/^-\s*/, "");

    // Match reminder::timestamp::message or reminder::active::timestamp::message
    const match = trimmed.match(
      /^reminder::(?:active::)?(\d{4}-\d{2}-\d{2}T[\d:.,+-]+)::(.+)/i
    );
    if (!match) continue;

    const reminderTime = new Date(match[1]);
    const reminderMessage = match[2].trim();

    if (isNaN(reminderTime.getTime())) continue;

    // Due if reminder time is in the past (or within the next 30 min window)
    if (reminderTime <= now) {
      dueReminders.push(reminderMessage);
    }
  }

  return dueReminders;
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

  const { agentAutonomousChat } = await import("./agent-llm");

  for (const task of pending) {
    try {
      updateTask(task.id, { status: "in_progress" });
      console.log(`[heartbeat] Scout working on: ${task.task.slice(0, 80)}`);

      const result = await agentAutonomousChat("scout", task.task, {
        fromAgent: task.from,
      });

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
