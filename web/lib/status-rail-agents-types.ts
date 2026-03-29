export type StatusRailHeartbeat = "ok" | "warn" | "error" | "none" | "skipped";

export type StatusRailMemory = "ok" | "warn" | "error" | "none";

export interface StatusRailAgentRow {
  heartbeat: StatusRailHeartbeat;
  heartbeatDetail: string;
  memory: StatusRailMemory;
  memoryMode: "vector" | "file" | "none";
  memoryDetail: string;
  memoryCount?: number;
}
