# Build context must be COMMAND-CENTRAL root (set in docker-compose.yml)
# so we can access both web/ and agents/ directories.

# ── Stage 1: Install dependencies ──
FROM node:20-alpine AS deps
WORKDIR /app
COPY web/package.json web/package-lock.json* ./
RUN npm ci

# ── Stage 2: Build ──
# Auth.js v5 middleware (Edge) needs NEXTAUTH_SECRET / AUTH_SECRET at build time so the
# standalone bundle can sign and verify sessions. Pass via compose build.args from web/.env.local.
FROM node:20-alpine AS builder
WORKDIR /app
ARG AUTH_SECRET
ARG NEXTAUTH_SECRET
ARG NEXT_PUBLIC_CC_RUNTIME_LABEL=
ENV AUTH_SECRET=$AUTH_SECRET
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET
ENV NEXT_PUBLIC_CC_RUNTIME_LABEL=$NEXT_PUBLIC_CC_RUNTIME_LABEL
COPY --from=deps /app/node_modules ./node_modules
COPY web/ .
RUN npm run build

# ── Stage 3: Production runner ──
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0
# Match docker-compose default so session JSONL + prompts resolve under /agents without relying on env_file alone
ENV AGENT_ROOT=/agents

# Copy agent prompts + seeded session files into container for runtime loading
COPY agents/ /agents/

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3001
CMD ["node", "server.js"]
