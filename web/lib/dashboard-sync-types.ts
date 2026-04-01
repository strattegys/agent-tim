/** Response shape for GET /api/dashboard-sync (badges + notifications in one round-trip). */

export type DashboardNotification = {
  type: string;
  title: string;
  message: string;
  timestamp: string;
  read?: boolean;
};

export type DashboardSyncBadges = {
  timMessagingTaskCount: number;
  timPendingQueueCount: number;
  ghostContentTaskCount: number;
  /** Suzi: CRM reminders currently due (same rule as heartbeat); drives sidebar work bell. */
  suziDueReminderCount: number;
};

export type DashboardSyncResponse = {
  badges: DashboardSyncBadges;
  notifications: DashboardNotification[];
};
