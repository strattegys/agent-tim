import { getBotApp } from "../app.js";
import { postDelegation } from "../notifications.js";

/**
 * Hook into delegation events to make them visible in Slack.
 * Called from tools.ts via the delegation callback.
 */
export async function onDelegation(
  fromAgent: string,
  toAgent: string,
  task: string,
  result: string
): Promise<void> {
  const fromApp = getBotApp(fromAgent);
  const toApp = getBotApp(toAgent);

  if (!fromApp || !toApp) {
    console.warn(`[delegation] Missing bot app for ${fromAgent} or ${toAgent}`);
    return;
  }

  try {
    await postDelegation(
      fromApp.app.client,
      toApp.app.client,
      fromAgent,
      toAgent,
      task,
      result
    );
  } catch (error) {
    console.error("[delegation] Error posting to Slack:", error);
  }
}
