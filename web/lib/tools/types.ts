/**
 * Shared types for the tools system.
 */

/** A Gemini-compatible function declaration */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

/** Category for grouping tools in the dashboard */
export type ToolCategory = "external" | "internal" | "meta";

/** Human-readable metadata for a tool (used by /api/tools and the dashboard) */
export interface ToolMetadata {
  id: string;
  displayName: string;
  category: ToolCategory;
  description: string;
  externalSystem?: string;
  operations: string[];
  requiresApproval: boolean;
}

/** A complete tool module: declaration + executor + metadata */
export interface ToolModule {
  declaration: ToolDeclaration;
  metadata: ToolMetadata;
  execute: (
    args: Record<string, string>,
    context: ToolContext
  ) => Promise<string>;
}

/** Context passed to every tool executor */
export interface ToolContext {
  lastUserMessage: string;
  agentId: string;
}
