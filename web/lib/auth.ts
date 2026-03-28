import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

/**
 * Auth.js middleware runs on the Edge runtime. In Docker standalone, Edge often does not see
 * runtime `env_file` the same way Node does — pass `NEXTAUTH_SECRET` / `AUTH_SECRET` as Docker
 * build args (see docker-compose.yml) so `next build` embeds them for middleware.
 */
let warnedMissingAuthSecret = false;
function resolveAuthSecret(): string {
  const fromEnv =
    process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV !== "production") {
    return "command-central-dev-auth-secret-not-for-production";
  }
  if (!warnedMissingAuthSecret) {
    warnedMissingAuthSecret = true;
    console.warn(
      "[auth] NEXTAUTH_SECRET / AUTH_SECRET unset in production — using an insecure fallback. Set in web/.env.local and pass Docker build args from the same file."
    );
  }
  return "command-central-insecure-fallback-set-NEXTAUTH_SECRET";
}

// Temporary: skip Google OAuth, use open access
// TODO: Add Google OAuth provider when credentials are ready
export const { handlers, signIn, signOut, auth } = NextAuth({
  // Required behind Caddy / any reverse proxy: Auth.js validates Host before our middleware runs getSession().
  trustHost: true,
  secret: resolveAuthSecret(),
  providers: [
    Credentials({
      name: "Open Access",
      credentials: {},
      authorize() {
        // Allow access without credentials for now
        return { id: "tim-user", email: "tim@local", name: "Tim User" };
      },
    }),
  ],
  callbacks: {
    session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
