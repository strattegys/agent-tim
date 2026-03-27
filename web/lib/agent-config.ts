/**
 * Backend Agent Config — Thin adapter over the Agent Registry.
 *
 * Existing callers (gemini.ts, heartbeat.ts, API routes) continue to use
 * getAgentConfig() and get the same AgentBackendConfig shape.
 */

import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getAgentSpec } from "./agent-registry";
import type { AgentSpec } from "./agent-spec";

/**
 * Where bot data lives on disk: explicit env, then usual Docker layout, then repo `agents/` next to `web/`.
 * Empty `AGENT_ROOT=` in .env.local no longer forces broken `/root/...` paths.
 */
function effectiveAgentRoot(): string | undefined {
  const fromEnv = process.env.AGENT_ROOT?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync("/agents")) return "/agents";
  const siblingAgents = join(process.cwd(), "..", "agents");
  if (existsSync(siblingAgents)) return siblingAgents;
  return undefined;
}

/**
 * Registry paths are authored as `/root/.suzibot/...`. Map to AGENT_ROOT (or auto-detected `/agents` / ../agents).
 */
export function resolveAgentDataPath(p: string): string {
  const root = effectiveAgentRoot();
  if (!root) return p;
  const normalized = p.replace(/\\/g, "/");
  if (!normalized.startsWith("/root/")) return p;
  return join(root, normalized.slice("/root/".length));
}

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

/** When set, all Groq-backed agents use this model id (e.g. dev: openai/gpt-oss-120b). Production omits it → registry default. */
function resolvedModelName(spec: AgentSpec): string | undefined {
  if (spec.provider === "groq") {
    const override = process.env.GROQ_CHAT_MODEL?.trim();
    if (override) return override;
  }
  return spec.modelName;
}

export function getAgentConfig(agentId: string): AgentBackendConfig {
  const spec = getAgentSpec(agentId);
  let sessionFile = spec.sessionFile;
  let memoryDir = spec.memoryDir;
  let systemPromptFile = spec.systemPromptFile;
  let vectorMemory = spec.vectorMemory;

  if (isChatEphemeralAgent(agentId)) {
    const base = join(process.cwd(), ".dev-ephemeral-chat", agentId);
    mkdirSync(base, { recursive: true });
    sessionFile = join(base, "chat.jsonl");
    memoryDir = join(base, "memory");
    vectorMemory = false;
  } else {
    sessionFile = resolveAgentDataPath(sessionFile);
    memoryDir = resolveAgentDataPath(memoryDir);
    systemPromptFile = resolveAgentDataPath(systemPromptFile);
  }

  return {
    id: spec.id,
    modelName: resolvedModelName(spec),
    temperature: spec.temperature,
    hasKanban: spec.workflowTypes.length > 0,
    sessionFile,
    systemPromptFile,
    memoryDir,
    tools: spec.tools,
    routines: spec.routines.map((r) => ({
      name: r.name,
      schedule: r.schedule,
      description: r.description,
      logFile: r.logFile ? resolveAgentDataPath(r.logFile) : undefined,
    })),
    vectorMemory,
    provider: spec.provider,
  };
}

