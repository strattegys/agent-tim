/**
 * Tool executor — dispatches tool calls to the correct module.
 */
import type { ToolContext } from "./types";
import { TOOL_REGISTRY } from "./index";

export async function executeTool(
  name: string,
  args: Record<string, string>,
  lastUserMessage = "",
  agentId = "tim"
): Promise<string> {
  try {
    const tool = TOOL_REGISTRY[name];
    if (!tool) return `Unknown tool: ${name}`;

    const context: ToolContext = { lastUserMessage, agentId };
    return await tool.execute(args, context);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Tool error: ${msg}`;
  }
}
