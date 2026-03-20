"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Notification {
  type: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [lastSeenEpoch, setLastSeenEpoch] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("notif_last_seen_epoch");
      return stored ? Number(stored) : 0;
    }
    return 0;
  });
  const panelRef = useRef<HTMLDivElement>(null);

  // Only show global alerts — not per-agent chat/reminder notifications
  const ALERT_TYPES = ["linkedin_inbound", "linkedin", "campaign", "schedule"];
  const alerts = notifications.filter((n) => ALERT_TYPES.includes(n.type));

  const unreadCount = lastSeenEpoch
    ? alerts.filter((n) => Date.parse(n.timestamp) > lastSeenEpoch).length
    : alerts.length;

  const fetchNotifications = useCallback(() => {
    fetch("/api/notifications")
      .then((res) => res.json())
      .then((data) => {
        if (data.notifications) {
          setNotifications(data.notifications);
        }
      })
      .catch(() => {});
  }, []);

  // Poll every 30s
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const handleOpen = () => {
    setIsOpen(!isOpen);
    if (!isOpen && alerts.length > 0) {
      const latestEpoch = Date.parse(alerts[0].timestamp);
      setLastSeenEpoch(latestEpoch);
      localStorage.setItem("notif_last_seen_epoch", String(latestEpoch));
    }
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleOpen}
        className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] relative"
        title="Alerts"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-[var(--accent-orange)] text-white text-[9px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-80 max-h-96 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl z-50">
          <div className="px-3 py-2 border-b border-[var(--border-color)] text-xs font-medium text-[var(--text-secondary)]">
            Alerts
          </div>
          {alerts.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--text-tertiary)]">
              No alerts
            </div>
          ) : (
            alerts.map((n, i) => (
              <div
                key={`${n.timestamp}-${i}`}
                className="px-3 py-2 border-b border-[var(--border-color)] last:border-b-0 hover:bg-[var(--bg-primary)] transition-colors"
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[10px] font-medium text-[var(--accent-blue)]">
                    {n.title}
                  </span>
                  <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">
                    {formatTime(n.timestamp)}
                  </span>
                </div>
                <div className="text-[12px] text-[var(--text-primary)] leading-snug line-clamp-3">
                  {n.message}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
