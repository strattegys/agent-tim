#!/usr/bin/env bash
# Production Command Central: always merge Tailscale CRM overlay when present.
#
# On the droplet, NEVER run plain `docker compose -f docker-compose.yml up` alone — that drops
# docker-compose.crm-db-tailscale.generated.yml and removes Postgres on the tailnet (100.x:5432).
#
#   cd /opt/agent-tim && ./tools/docker-compose-cc-prod.sh up -d
#   cd /opt/agent-tim && ./tools/docker-compose-cc-prod.sh logs -f web
#
set -euo pipefail
COMPOSE_DIR="${COMPOSE_DIR:-/opt/agent-tim}"
cd "$COMPOSE_DIR"

if [[ ! -f web/.env.local ]]; then
  echo "ERROR: web/.env.local missing (required for --env-file)." >&2
  exit 1
fi

args=(--env-file web/.env.local -f docker-compose.yml)
if [[ -f docker-compose.crm-db-tailscale.generated.yml ]]; then
  args+=(-f docker-compose.crm-db-tailscale.generated.yml)
fi

exec docker compose "${args[@]}" "$@"
