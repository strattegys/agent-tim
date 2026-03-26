/** Primary product headline (login, sidebar, PWA description). */
export function getAppHeadline(): string {
  return "Agent Team";
}

/**
 * Visible app name (sidebar subtitle, document title) and matches document title logic in layout.
 * DEV: local `next dev` (NODE_ENV=development), or set NEXT_PUBLIC_COMMAND_CENTRAL_DEV=1 on a hosted dev instance.
 */
export function getAppBrandTitle(): string {
  if (process.env.NEXT_PUBLIC_COMMAND_CENTRAL_DEV === "1") {
    return "Agent Team";
  }
  if (process.env.NODE_ENV === "development") {
    return "Agent Team";
  }
  return "Strattegys Command Central";
}

export function isDevAppBranding(): boolean {
  return (
    process.env.NEXT_PUBLIC_COMMAND_CENTRAL_DEV === "1" ||
    process.env.NODE_ENV === "development"
  );
}
