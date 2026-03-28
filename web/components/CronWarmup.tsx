"use client";

import { useEffect } from "react";

/** Triggers server cron init via API so RootLayout never imports Node-only cron. */
export function CronWarmup() {
  useEffect(() => {
    void fetch("/api/health", { credentials: "include" }).catch(() => {});
  }, []);
  return null;
}
