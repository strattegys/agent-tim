/** Text in the sidebar / mobile agent-list header box only (document title unchanged). */
export const SIDEBAR_HEADER_TITLE = "Agent Team";

/** Short tagline (metadata description, login subtitle). */
export function getAppHeadline(): string {
  return "CRM and agent workspace";
}

/**
 * Visible app name (document title, login heading).
 * DEV: local `next dev` (NODE_ENV=development), or set NEXT_PUBLIC_COMMAND_CENTRAL_DEV=1 on a hosted dev instance.
 */
export function getAppBrandTitle(): string {
  if (process.env.NEXT_PUBLIC_COMMAND_CENTRAL_DEV === "1") {
    return "Strattegys Command Central · Local";
  }
  if (process.env.NODE_ENV === "development") {
    return "Strattegys Command Central · Local";
  }
  return "Strattegys Command Central";
}

export function isDevAppBranding(): boolean {
  return (
    process.env.NEXT_PUBLIC_COMMAND_CENTRAL_DEV === "1" ||
    process.env.NODE_ENV === "development"
  );
}

