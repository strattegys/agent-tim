/**
 * Parse Marni KB API responses. Surfaces HTML (proxy 404, login page, Next error page) as clear errors.
 */

function htmlSnippet(t: string): string {
  return t.slice(0, 120).replace(/\s+/g, " ").trim();
}

export async function readMarniKbApiJson<T = Record<string, unknown>>(r: Response): Promise<T> {
  const text = await r.text();
  const t = text.trim();
  const pageOrigin = typeof window !== "undefined" ? window.location.origin : "";
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
    const ping = pageOrigin ? `${pageOrigin}/api/marni-kb/ping` : "/api/marni-kb/ping";
    throw new Error(
      "Marni Knowledge Base expected JSON from the API but received an HTML page instead. " +
        `That usually means this environment is not running a build that includes /api/marni-kb/* (deploy latest), or a reverse proxy answered before Next.js (wrong host on port 80). ` +
        `Facts: HTTP ${r.status}, response URL after redirects: ${r.url}` +
        (pageOrigin ? `, page origin: ${pageOrigin}` : "") +
        `. Try ${ping} in this browser — if you do not see JSON, the app or proxy in front of it is wrong for this URL. ` +
        `HTML starts: ${htmlSnippet(t)}`
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
