/**
 * Backend Agent Config — Thin adapter over the Agent Registry.
 *
 * Existing callers (gemini.ts, heartbeat.ts, API routes) continue to use
 * getAgentConfig() and get the same AgentBackendConfig shape.
 */

import { mkdirSync } from "fs";
import { join } from "path";
import { getAgentSpec } from "./agent-registry";

/** Comma-separated agent ids in CHAT_EPHEMERAL_AGENTS — local-only session + memory dirs, no vector RAG. */
export function isChatEphemeralAgent(agentId: string): boolean {
  const raw = process.env.CHAT_EPHEMERAL_AGENTS?.trim();
  if (!raw) return false;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(agentId.toLowerCase());
}

export interface Routine {
  name: string;
  schedule: string;
  description: string;
  logFile?: string;
}

export interface AgentBackendConfig {
  id: string;
  modelName?: string;
  temperature?: number;
  hasKanban?: boolean;
  sessionFile: string;
  systemPromptFile: string;
  memoryDir: string;
  tools: string[];
  routines: Routine[];
  vectorMemory?: boolean;
  provider?: "gemini" | "anthropic" | "groq";
}

export function getAgentConfig(agentId: string): AgentBackendConfig {
  const spec = getAgentSpec(agentId);
  let sessionFile = spec.sessionFile;
  let memoryDir = spec.memoryDir;
  let vectorMemory = spec.vectorMemory;

  if (isChatEphemeralAgent(agentId)) {
    const base = join(process.cwd(), ".dev-ephemeral-chat", agentId);
    mkdirSync(base, { recursive: true });
    sessionFile = join(base, "chat.jsonl");
    memoryDir = join(base, "memory");
    vectorMemory = false;
  }

  return {
    id: spec.id,
    modelName: spec.modelName,
    temperature: spec.temperature,
    hasKanban: spec.workflowTypes.length > 0,
    sessionFile,
    systemPromptFile: spec.systemPromptFile,
    memoryDir,
    tools: spec.tools,
    routines: spec.routines.map((r) => ({
      name: r.name,
      schedule: r.schedule,
      description: r.description,
      logFile: r.logFile,
    })),
    vectorMemory,
    provider: spec.provider,
  };
}

