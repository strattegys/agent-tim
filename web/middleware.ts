import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

/** Paths that must never require a session (img src, webhooks, NextAuth). Matcher regex can miss edge cases. */
function isPublicPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname === "/backend-only") return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/api/webhooks")) return true;
  if (pathname.startsWith("/api/agent-avatar")) return true;
  if (pathname === "/api/health" || pathname.startsWith("/api/health/"))
    return true;
  /** PWA share target POST must reach the handler (session checked inside); redirect would drop body. */
  if (pathname === "/share-intake") return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico" || pathname === "/sw.js") return true;
  return false;
}

export default auth((req) => {
  if (isPublicPath(req.nextUrl.pathname)) {
    return NextResponse.next();
  }
  // Allow internal server-to-server calls (cron, scripts, etc.)
  const internalKey = process.env.INTERNAL_API_KEY?.trim();
  if (internalKey && req.headers.get("x-internal-key") === internalKey) {
    return NextResponse.next();
  }
  // LinkedIn webhook → warm-outreach auto-resolve calls this route via loopback/fetch (no browser session)
  const whSecret = process.env.UNIPILE_WEBHOOK_SECRET?.trim();
  if (
    whSecret &&
    req.method === "POST" &&
    req.nextUrl.pathname === "/api/crm/human-tasks/resolve" &&
    (req.headers.get("authorization") === `Bearer ${whSecret}` ||
      req.headers.get("unipile-auth") === whSecret)
  ) {
    return NextResponse.next();
  }
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - /login, /backend-only
     * - /api/auth (NextAuth routes)
     * - /api/webhooks (external webhooks like Unipile)
     * - /_next (Next.js internals)
     * - /favicon.ico, /sw.js, static files
     */
    // api/agent-avatar must stay public: <img src> requests often omit auth cookies in edge cases; a redirect breaks icons.
    // Explicit "/" — some Next matcher regexes skip the bare root on certain versions.
    "/",
    "/((?!login|backend-only|api/auth|api/webhooks|api/agent-avatar|_next|favicon\\.ico|sw\\.js|.*\\.).*)",
  ],
};
