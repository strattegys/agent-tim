/** Response shape for GET /api/dashboard-sync (badges + notifications in one round-trip). */

export type DashboardNotification = {
  type: string;
  title: string;
  message: string;
  timestamp: string;
  read?: boolean;
};

export type DashboardSyncBadges = {
  pendingTaskCount: number;
  testingTaskCount: number;
  timMessagingTaskCount: number;
  timPendingQueueCount: number;
  ghostContentTaskCount: number;
};

export type DashboardSyncResponse = {
  badges: DashboardSyncBadges;
  notifications: DashboardNotification[];
};
