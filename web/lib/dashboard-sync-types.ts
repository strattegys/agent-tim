/** Response shape for GET /api/dashboard-sync (badges + notifications in one round-trip). */

export type DashboardNotification = {
  type: string;
  title: string;
  message: string;
  timestamp: string;
  read?: boolean;
};

export type DashboardSyncBadges = {
  /** Tim: workflow “active” rows (human-task open, excludes warm MESSAGED waiting). */
  timMessagingTaskCount: number;
  /** Legacy; kept for older clients. Prefer timUnifiedMessagingCount for Tim’s single queue tab. */
  timPendingQueueCount: number;
  /** Tim: active + pending follow-up + LinkedIn inbound receipt rows (approx. unified list size). */
  timUnifiedMessagingCount: number;
  ghostContentTaskCount: number;
  /** Marni: distribution items with humanTaskOpen (needs review), excluding scheduled POSTED-only rows. */
  marniWorkQueueCount: number;
  /** Suzi: CRM reminders currently due (same rule as heartbeat); drives sidebar work bell. */
  suziDueReminderCount: number;
};

export type DashboardSyncResponse = {
  badges: DashboardSyncBadges;
  notifications: DashboardNotification[];
};
