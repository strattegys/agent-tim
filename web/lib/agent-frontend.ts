/**
 * Frontend Agent Config — Projects AgentSpec into the AgentConfig shape
 * consumed by the chat UI and sidebar components.
 */

import { getAllAgentSpecs } from "./agent-registry";
import type { AgentCategory } from "./agent-spec";

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  color: string;
  avatar?: string;
  online: boolean;
  capabilities: string[];
  connections: { label: string; connected: boolean }[];
  category: AgentCategory;
  ttsVoice?: string;
}

export const AGENT_CATEGORIES = ["Utility", "MarkOps", "ContentOps", "FinOps", "Toys"] as const;

export function getFrontendAgents(): AgentConfig[] {
  return getAllAgentSpecs().map((spec) => ({
    id: spec.id,
    name: spec.name,
    role: spec.role,
    color: spec.color,
    avatar: spec.avatar,
    online: true,
    capabilities: spec.capabilities,
    connections: spec.connections.map((c) => ({
      label: c.label,
      connected: c.connected,
    })),
    category: spec.category,
    ttsVoice: spec.ttsVoice,
  }));
}
