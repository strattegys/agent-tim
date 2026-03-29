/**
 * Parse Marni KB API responses. Surfaces HTML (Caddy 404, login page, Next error page) as clear errors.
 */

export async function readMarniKbApiJson<T = Record<string, unknown>>(r: Response): Promise<T> {
  const text = await r.text();
  const t = text.trim();
  if (r.status === 401) {
    let msg =
      "Sign in required — sign in on Command Central, then try again. Use the same host in the browser as NEXTAUTH_URL / AUTH_URL in web/.env.local (do not mix localhost and 127.0.0.1).";
    try {
      const j = JSON.parse(t) as { error?: string };
      if (j.error && j.error !== "Unauthorized") msg = j.error;
    } catch {
      /* non-JSON 401 body */
    }
    throw new Error(msg);
  }
  if (
    t.startsWith("<!DOCTYPE") ||
    t.startsWith("<!doctype") ||
    t.startsWith("<html") ||
    t.startsWith("<HTML")
  ) {
    if (r.redirected || r.url.includes("/login")) {
      throw new Error("Session expired or not signed in — refresh the page and log in again.");
    }
    if (r.status === 404) {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const ping = origin ? `${origin}/api/marni-kb/ping` : "/api/marni-kb/ping";
      throw new Error(
        "Marni Knowledge Base API got HTTP 404 as HTML — the request did not reach the Next.js API route (often the reverse proxy, not the app). " +
          "Production compose + Caddy: use http://localhost, http://127.0.0.1, or the production hostname in Caddyfile; if you use another host (LAN IP, machine name, host.docker.internal), add it to Caddyfile and restart Caddy. " +
          "Dev compose (docker-compose.dev.yml): use http://localhost:3001 only, not port 80. " +
          "Remote server: rebuild and redeploy the web image from current master. " +
          `Quick check (must return JSON): ${ping}`
      );
    }
    throw new Error(
      `Server returned a web page instead of JSON (HTTP ${r.status}). Try refreshing or restarting the dev server.`
    );
  }
  if (!t) {
    throw new Error(`Empty response (HTTP ${r.status})`);
  }
  try {
    return JSON.parse(t) as T;
  } catch {
    throw new Error(
      t.length > 200 ? `${t.slice(0, 200)}…` : t || `Invalid JSON (HTTP ${r.status})`
    );
  }
}
