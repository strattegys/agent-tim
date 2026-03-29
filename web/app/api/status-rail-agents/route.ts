import { NextResponse } from "next/server";
import { AGENT_REGISTRY } from "@/lib/agent-registry";
import { getCronJobs } from "@/lib/cron";
import { checkMemoryHealth, type MemoryHealthResult } from "@/lib/memory-health";
import type { StatusRailAgentRow, StatusRailHeartbeat } from "@/lib/status-rail-agents-types";

function deriveMemoryRow(
  specHasMemory: boolean,
  health: MemoryHealthResult | null,
  fetchError: string | null
): Pick<StatusRailAgentRow, "memory" | "memoryMode" | "memoryDetail" | "memoryCount"> {
  if (!specHasMemory) {
    return {
      memory: "none",
      memoryMode: "none",
      memoryDetail: "No memory tool",
    };
  }
  if (fetchError) {
    return {
      memory: "error",
      memoryMode: "none",
      memoryDetail: fetchError,
    };
  }
  if (!health || !health.enabled) {
    return {
      memory: "none",
      memoryMode: "none",
      memoryDetail: "Memory not enabled",
    };
  }

  const memoryMode = health.mode === "vector" ? "vector" : "file";
  const memoryCount = health.memoryCount;

  if (health.ok) {
    return {
      memory: "ok",
      memoryMode,
      memoryCount,
      memoryDetail:
        health.mode === "vector"
          ? `Semantic memory OK (${health.memoryCount ?? 0} memories)`
          : health.ephemeral
            ? "File memory OK (local ephemeral)"
            : "File memory OK",
    };
  }

  if (health.mode === "vector" && health.database === "ok" && health.embeddings !== "ok") {
    return {
      memory: "warn",
      memoryMode,
      memoryCount,
      memoryDetail: health.embeddingDetail || "Embeddings issue (check GEMINI_API_KEY)",
    };
  }

  return {
    memory: "error",
    memoryMode,
    memoryCount,
    memoryDetail:
      health.databaseDetail ||
      health.embeddingDetail ||
      health.fileDetail ||
      "Memory backend not ready",
  };
}

/**
 * One round-trip for the right status rail: per-agent heartbeat (cron) + memory health.
 */
export async function GET() {
  const agents: Record<string, StatusRailAgentRow> = {};
  const specs = Object.values(AGENT_REGISTRY).filter((s) => s.category !== "Toys");

  const memoryWithTool = specs.filter((s) => s.tools.includes("memory"));
  const memoryResults = await Promise.all(
    memoryWithTool.map(async (spec) => {
      try {
        const health = await checkMemoryHealth(spec.id);
        return { id: spec.id, health, error: null as string | null };
      } catch (e) {
        return {
          id: spec.id,
          health: null as MemoryHealthResult | null,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    })
  );
  const memoryMap = new Map(memoryResults.map((r) => [r.id, r]));

  for (const spec of specs) {
    const hbJob = getCronJobs(spec.id).find((j) => j.id === `heartbeat-${spec.id}`);
    let heartbeat: StatusRailHeartbeat = "none";
    let heartbeatDetail = "No heartbeat job for this agent";

    if (hbJob) {
      if (!hbJob.enabled) {
        heartbeat = "skipped";
        heartbeatDetail = "Heartbeat job disabled";
      } else if (!hbJob.lastRun) {
        heartbeat = "warn";
        heartbeatDetail = "Heartbeat not run yet (server may have just started)";
      } else if (hbJob.lastResult === "success") {
        heartbeat = "ok";
        heartbeatDetail = `Last run ${hbJob.lastRun.toISOString()}`;
      } else {
        heartbeat = "error";
        heartbeatDetail = hbJob.lastResult || "Last run failed";
      }
    }

    const mem = memoryMap.get(spec.id);
    const memRow = deriveMemoryRow(
      spec.tools.includes("memory"),
      mem?.health ?? null,
      mem?.error ?? null
    );

    agents[spec.id] = {
      heartbeat,
      heartbeatDetail,
      ...memRow,
    };
  }

  return NextResponse.json({ agents });
}
