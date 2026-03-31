import type { DashboardSyncResponse } from "@/lib/dashboard-sync-types";

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  if (!res.ok) return null;
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Build dashboard badges + notifications (same as GET /api/dashboard-sync).
 * Used by the JSON route and the SSE stream.
 */
export async function fetchDashboardSyncPayload(
  origin: string,
  cookieHeader: string
): Promise<DashboardSyncResponse> {
  const h = { cookie: cookieHeader } as HeadersInit;

  const [rActive, rApproval, rTim, rGhost, rNotif, rSuziDue] = await Promise.all([
    fetch(`${origin}/api/crm/human-tasks?packageStage=ACTIVE`, { headers: h, cache: "no-store" }),
    fetch(`${origin}/api/crm/human-tasks?packageStage=PENDING_APPROVAL`, { headers: h, cache: "no-store" }),
    fetch(`${origin}/api/crm/human-tasks?ownerAgent=tim&summary=1`, { headers: h, cache: "no-store" }),
    fetch(
      `${origin}/api/crm/human-tasks?ownerAgent=ghost&sourceType=content&excludePackageStages=DRAFT,PENDING_APPROVAL`,
      { headers: h, cache: "no-store" }
    ),
    fetch(`${origin}/api/notifications`, { headers: h, cache: "no-store" }),
    fetch(`${origin}/api/reminders?dueSummary=1&agentId=suzi`, { headers: h, cache: "no-store" }),
  ]);

  const [dActive, dApproval, dTim, dGhost, dNotif, dSuziDue] = await Promise.all([
    readJson(rActive),
    readJson(rApproval),
    readJson(rTim),
    readJson(rGhost),
    readJson(rNotif),
    readJson(rSuziDue),
  ]);

  const pendingTaskCount = typeof dActive?.count === "number" ? dActive.count : 0;
  const testingTaskCount = typeof dApproval?.count === "number" ? dApproval.count : 0;

  let timMessagingTaskCount = 0;
  let timPendingQueueCount = 0;
  if (dTim) {
    timMessagingTaskCount = typeof dTim.count === "number" ? dTim.count : 0;
    if (typeof dTim.pendingFollowUpCount === "number") {
      timPendingQueueCount = dTim.pendingFollowUpCount;
    } else if (Array.isArray(dTim.tasks)) {
      timPendingQueueCount = (dTim.tasks as { waitingFollowUp?: boolean }[]).filter((t) =>
        Boolean(t.waitingFollowUp)
      ).length;
    }
  }

  const ghostContentTaskCount = typeof dGhost?.count === "number" ? dGhost.count : 0;

  const suziDueReminderCount =
    typeof dSuziDue?.dueCount === "number" ? dSuziDue.dueCount : 0;

  const rawList = dNotif?.notifications;
  const notifications = Array.isArray(rawList) ? (rawList as DashboardSyncResponse["notifications"]) : [];

  return {
    badges: {
      pendingTaskCount,
      testingTaskCount,
      timMessagingTaskCount,
      timPendingQueueCount,
      ghostContentTaskCount,
      suziDueReminderCount,
    },
    notifications,
  };
}
