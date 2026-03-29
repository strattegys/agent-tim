/** Human / queue work waiting for the user, mapped to the agent that owns that queue. */

export type WorkBadgeCounts = {
  pendingTaskCount: number;
  testingTaskCount: number;
  timMessagingTaskCount: number;
  ghostContentTaskCount: number;
};

export function agentHasUserWorkItem(agentId: string, b: WorkBadgeCounts): boolean {
  switch (agentId) {
    case "friday":
      return b.pendingTaskCount > 0;
    case "penny":
      return b.testingTaskCount > 0;
    case "tim":
      return b.timMessagingTaskCount > 0;
    case "ghost":
      return b.ghostContentTaskCount > 0;
    default:
      return false;
  }
}
