/** Human / queue work waiting for the user, mapped to the agent that owns that queue. */

export type WorkBadgeCounts = {
  timMessagingTaskCount: number;
  /** Tim unified queue (workflow + inbound receipts); drives work bell when set. */
  timUnifiedMessagingCount: number;
  ghostContentTaskCount: number;
  marniWorkQueueCount: number;
  suziDueReminderCount: number;
};

export function agentHasUserWorkItem(agentId: string, b: WorkBadgeCounts): boolean {
  switch (agentId) {
    // Friday / Penny: CRM counts are background context only until we define user-facing alerts.
    case "friday":
    case "penny":
      return false;
    case "tim":
      return (
        (typeof b.timUnifiedMessagingCount === "number" ? b.timUnifiedMessagingCount : 0) > 0 ||
        b.timMessagingTaskCount > 0
      );
    case "ghost":
      return b.ghostContentTaskCount > 0;
    case "marni":
      return (typeof b.marniWorkQueueCount === "number" ? b.marniWorkQueueCount : 0) > 0;
    case "suzi":
      return b.suziDueReminderCount > 0;
    default:
      return false;
  }
}
