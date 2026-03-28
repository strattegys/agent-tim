"use client";

import { useState, useEffect } from "react";

/** True when `document.visibilityState === "visible"` (tab in foreground). */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "visible"
  );
  useEffect(() => {
    const fn = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  }, []);
  return visible;
}
