/**
 * When warm-outreach items are at MESSAGED with dueDate <= now, advance to MESSAGE_DRAFT
 * via the same path as human "Continue" (POST human-tasks/resolve approve).
 * Called from the warm-outreach-discovery cron tick so follow-ups open without a manual task.
 */

import { query } from "@/lib/db";

export async function advanceWarmOutreachMessagedFollowupsPastDue(): Promise<number> {
  const key = process.env.INTERNAL_API_KEY?.trim();
  if (!key) {
    console.warn(
      "[warm-outreach-followup-due] INTERNAL_API_KEY unset — cannot call resolve from cron; set INTERNAL_API_KEY and APP_INTERNAL_URL (or VERCEL_URL / NEXT_PUBLIC_APP_URL) for auto follow-ups"
    );
    return 0;
  }

  const base =
    process.env.APP_INTERNAL_URL?.replace(/\/$/, "") ||
    process.env.INTERNAL_APP_URL?.replace(/\/$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "";

  if (!base) {
    console.warn(
      "[warm-outreach-followup-due] No base URL (APP_INTERNAL_URL / VERCEL_URL / NEXT_PUBLIC_APP_URL) — skip auto follow-ups"
    );
    return 0;
  }

  const rows = await query<{ id: string }>(
    `SELECT wi.id
     FROM "_workflow_item" wi
     INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
     WHERE wi."deletedAt" IS NULL
       AND UPPER(TRIM(wi.stage::text)) = 'MESSAGED'
       AND wi."dueDate" IS NOT NULL
       AND wi."dueDate" <= NOW()
       AND COALESCE(w.spec::text, '') LIKE '%"workflowType"%'
       AND COALESCE(w.spec::text, '') LIKE '%warm-outreach%'`
  );

  let n = 0;
  for (const r of rows) {
    try {
      const res = await fetch(`${base}/api/crm/human-tasks/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-key": key,
        },
        body: JSON.stringify({ itemId: r.id, action: "approve" }),
      });
      if (res.ok) {
        n++;
      } else {
        const t = await res.text().catch(() => "");
        console.warn("[warm-outreach-followup-due] resolve failed", r.id, res.status, t.slice(0, 200));
      }
    } catch (e) {
      console.warn("[warm-outreach-followup-due] fetch error", r.id, e);
    }
  }
  return n;
}
