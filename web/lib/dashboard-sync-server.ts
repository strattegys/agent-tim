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

  const [rTim, rGhost, rMarni, rNotif, rSuziDue] = await Promise.all([
    fetch(`${origin}/api/crm/human-tasks?ownerAgent=tim&summary=1`, { headers: h, cache: "no-store" }),
    fetch(
      `${origin}/api/crm/human-tasks?ownerAgent=ghost&sourceType=content&excludePackageStages=DRAFT,PENDING_APPROVAL`,
      { headers: h, cache: "no-store" }
    ),
    fetch(`${origin}/api/crm/human-tasks?ownerAgent=marni&distributionOnly=1&limit=150&offset=0`, {
      headers: h,
      cache: "no-store",
    }),
    fetch(`${origin}/api/notifications`, { headers: h, cache: "no-store" }),
    fetch(`${origin}/api/reminders?dueSummary=1&agentId=suzi`, { headers: h, cache: "no-store" }),
  ]);

  const [dTim, dGhost, dMarni, dNotif, dSuziDue] = await Promise.all([
    readJson(rTim),
    readJson(rGhost),
    readJson(rMarni),
    readJson(rNotif),
    readJson(rSuziDue),
  ]);

  let timMessagingTaskCount = 0;
  let timPendingQueueCount = 0;
  let timUnifiedMessagingCount = 0;
  if (dTim) {
    timMessagingTaskCount = typeof dTim.count === "number" ? dTim.count : 0;
    if (typeof dTim.pendingFollowUpCount === "number") {
      timPendingQueueCount = dTim.pendingFollowUpCount;
    } else if (Array.isArray(dTim.tasks)) {
      timPendingQueueCount = (dTim.tasks as { waitingFollowUp?: boolean }[]).filter((t) =>
        Boolean(t.waitingFollowUp)
      ).length;
    }
    if (typeof dTim.unifiedMessagingCount === "number") {
      timUnifiedMessagingCount = dTim.unifiedMessagingCount;
    } else {
      timUnifiedMessagingCount = timMessagingTaskCount + timPendingQueueCount;
    }
  }

  const ghostContentTaskCount = typeof dGhost?.count === "number" ? dGhost.count : 0;

  let marniWorkQueueCount = 0;
  const marniTasks = Array.isArray(dMarni?.tasks) ? (dMarni.tasks as { humanTaskOpen?: boolean; stage?: string; dueDate?: string | null }[]) : [];
  const nowMs = Date.now();
  for (const t of marniTasks) {
    if (t.humanTaskOpen !== true) continue;
    const st = String(t.stage || "").trim().toUpperCase();
    if (st === "POSTED" && t.dueDate) {
      const ms = new Date(String(t.dueDate)).getTime();
      if (Number.isFinite(ms) && ms > nowMs) continue;
    }
    marniWorkQueueCount += 1;
  }

  const suziDueReminderCount =
    typeof dSuziDue?.dueCount === "number" ? dSuziDue.dueCount : 0;

  const rawList = dNotif?.notifications;
  const notifications = Array.isArray(rawList) ? (rawList as DashboardSyncResponse["notifications"]) : [];

  return {
    badges: {
      timMessagingTaskCount,
      timPendingQueueCount,
      timUnifiedMessagingCount,
      ghostContentTaskCount,
      marniWorkQueueCount,
      suziDueReminderCount,
    },
    notifications,
  };
}
