/**
 * When true, main app pages redirect to `/backend-only`.
 * APIs and webhooks keep working. `/login` redirects to `/backend-only` (no session on this host).
 *
 * Set in `web/.env.local` on the droplet (runtime — works with standalone Docker).
 * Values (case-insensitive): false | 0 | backend | off
 */
export function isBackendOnlyUiMode(): boolean {
  const v = process.env.CC_PUBLIC_APP_UI?.trim().toLowerCase();
  return v === "false" || v === "0" || v === "backend" || v === "off";
}

/**
 * Mobile-only public UI: `/` redirects to `/m/suzi`; `/login` works; `/m/**` is the app shell.
 * Full Command Central desktop chat is not served at `/`.
 *
 * `CC_PUBLIC_APP_UI=mobile` (case-insensitive).
 */
export function isMobilePublicUiMode(): boolean {
  return process.env.CC_PUBLIC_APP_UI?.trim().toLowerCase() === "mobile";
}
