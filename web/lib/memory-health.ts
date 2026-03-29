import { accessSync, constants, existsSync } from "fs";
import { query } from "./db";
import { embedText } from "./embeddings";
import { hasGeminiApiKey } from "./gemini-api-key";
import { getAgentConfig, isChatEphemeralAgent } from "./agent-config";
import { getAgentSpec } from "./agent-registry";

export interface MemoryHealthResult {
  enabled: boolean;
  agentId: string;
  mode: "none" | "vector" | "file";
  ok: boolean;
  ephemeral: boolean;
  memoryDir?: string;
  database?: "ok" | "unavailable" | "error";
  databaseDetail?: string;
  memoryCount?: number;
  embeddings?: "ok" | "not_required" | "missing_key" | "error";
  embeddingDetail?: string;
  fileBackend?: "ok" | "deferred" | "error";
  fileDetail?: string;
}

const USE_DEV_STORE = !process.env.CRM_DB_PASSWORD;

function fileMemoryHealthy(memoryDir: string): { ok: boolean; detail?: string; deferred?: boolean } {
  try {
    if (!existsSync(memoryDir)) {
      return { ok: true, deferred: true, detail: "Created on first save" };
    }
    accessSync(memoryDir, constants.R_OK | constants.W_OK);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : "Cannot read or write memory folder",
    };
  }
}

/**
 * Live check for agent long-term memory: CRM + embeddings for vector agents,
 * filesystem for file-based agents. Use in API routes and ops tooling.
 */
export async function checkMemoryHealth(agentId: string): Promise<MemoryHealthResult> {
  const id = agentId.trim().toLowerCase();
  const spec = getAgentSpec(id);
  if (!spec.tools.includes("memory")) {
    return {
      enabled: false,
      agentId: id,
      mode: "none",
      ok: true,
      ephemeral: false,
    };
  }

  const ephemeral = isChatEphemeralAgent(id);
  const config = getAgentConfig(id);
  const vector = !!config.vectorMemory;
  const memoryDir = config.memoryDir;

  if (!vector) {
    const file = fileMemoryHealthy(memoryDir);
    return {
      enabled: true,
      agentId: id,
      mode: "file",
      ok: file.ok,
      ephemeral,
      memoryDir,
      fileBackend: file.deferred ? "deferred" : file.ok ? "ok" : "error",
      fileDetail: file.detail,
    };
  }

  const base: MemoryHealthResult = {
    enabled: true,
    agentId: id,
    mode: "vector",
    ok: false,
    ephemeral,
    memoryDir,
  };

  if (USE_DEV_STORE) {
    const hasGeminiKey = hasGeminiApiKey();
    return {
      ...base,
      database: "unavailable",
      databaseDetail:
        "CRM_DB_PASSWORD is unset — app is using .dev-store, not Postgres. Vector memory needs CRM_DB_* in web/.env.local (same DB as npm run db:exec).",
      embeddings: hasGeminiKey ? "error" : "missing_key",
      embeddingDetail: hasGeminiKey
        ? "Gemini key is set, but vector rows live in CRM Postgres — connect the DB to use semantic memory."
        : "Set GEMINI_API_KEY (or GOOGLE_API_KEY) for embeddings once CRM Postgres is configured.",
    };
  }

  let memoryCount = 0;
  try {
    const rows = await query<{ n: string | number }>(
      `SELECT COUNT(*)::int AS n FROM "_memory"
       WHERE "agentId" = $1 AND "deletedAt" IS NULL AND "isActive" = TRUE`,
      [id]
    );
    memoryCount = Number(rows[0]?.n ?? 0);
    base.database = "ok";
    base.memoryCount = memoryCount;
  } catch (e) {
    base.database = "error";
    base.databaseDetail = e instanceof Error ? e.message : String(e);
  }

  if (!hasGeminiApiKey()) {
    base.embeddings = "missing_key";
    base.embeddingDetail =
      "GEMINI_API_KEY or GOOGLE_API_KEY is required for vector memory (Gemini embeddings). Restart dev after editing web/.env.local.";
  } else {
    try {
      await embedText("memory health probe", {
        agentId: "system",
        purpose: "memory_health_probe",
      });
      base.embeddings = "ok";
    } catch (e) {
      base.embeddings = "error";
      base.embeddingDetail = e instanceof Error ? e.message : String(e);
    }
  }

  base.ok = base.database === "ok" && base.embeddings === "ok";
  return base;
}
