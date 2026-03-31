import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { isLinkedInInboundHiddenFromAlerts } from "@/lib/notification-filters";

const NOTIFICATIONS_FILE =
  process.env.WEB_NOTIFICATIONS_FILE || "/root/.nanobot/web_notifications.jsonl";
const MAX_NOTIFICATIONS = 50;

interface Notification {
  type: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export async function GET() {
  if (!existsSync(NOTIFICATIONS_FILE)) {
    return NextResponse.json({ notifications: [] });
  }

  try {
    const raw = readFileSync(NOTIFICATIONS_FILE, "utf-8").trim();
    if (!raw) return NextResponse.json({ notifications: [] });

    const notifications: Notification[] = raw
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line) as Notification;
        } catch {
          return null;
        }
      })
      .filter((n): n is Notification => n !== null)
      .filter((n) => !isLinkedInInboundHiddenFromAlerts(n))
      .reverse()
      .slice(0, MAX_NOTIFICATIONS);

    return NextResponse.json({ notifications });
  } catch {
    return NextResponse.json({ notifications: [] });
  }
}
