/**
 * Web notification system — writes to JSONL file polled by the notification bell.
 */
import { appendFileSync } from "fs";

const NOTIFICATIONS_FILE =
  process.env.WEB_NOTIFICATIONS_FILE || "/root/.nanobot/web_notifications.jsonl";

export function writeNotification(
  title: string,
  message: string,
  type = "heartbeat"
): void {
  try {
    const entry = JSON.stringify({
      type,
      title,
      message,
      timestamp: new Date().toISOString(),
      read: false,
    });
    appendFileSync(NOTIFICATIONS_FILE, entry + "\n");
  } catch (error) {
    console.error("[notifications] Failed to write notification:", error);
  }
}
