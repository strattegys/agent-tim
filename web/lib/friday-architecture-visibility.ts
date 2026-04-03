/**
 * When NEXT_PUBLIC_HIDE_ARCHITECTURE_TAB is set to 1 / true / yes, the Friday Architecture tab is hidden
 * (URL still maps panel=architecture for bookmarks, but the UI falls back to Dashboard tab).
 */

export function isFridayArchitectureTabHidden(): boolean {
  const v = process.env.NEXT_PUBLIC_HIDE_ARCHITECTURE_TAB?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
