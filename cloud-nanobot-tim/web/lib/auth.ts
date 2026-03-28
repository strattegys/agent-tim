import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

// Temporary: skip Google OAuth, use open access
// TODO: Add Google OAuth provider when credentials are ready
export const { handlers, signIn, signOut, auth } = NextAuth({
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
