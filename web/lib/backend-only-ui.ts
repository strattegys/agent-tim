/**
 * When true, main app pages redirect to `/backend-only`.
 * APIs, webhooks, and `/login` still work; login immediately redirects to the landing page.
 *
 * Set in `web/.env.local` on the droplet (runtime — works with standalone Docker).
 * Values (case-insensitive): false | 0 | backend | off
 */
export function isBackendOnlyUiMode(): boolean {
  const v = process.env.CC_PUBLIC_APP_UI?.trim().toLowerCase();
  return v === "false" || v === "0" || v === "backend" || v === "off";
}
