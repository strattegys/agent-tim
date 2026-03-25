#!/bin/bash
# Run: Get-Content -Raw scripts/remote-docker-rebuild-web.sh | ssh root@HOST bash -s
set -eu
cd /opt/agent-tim
echo "Pulling latest code..."
git fetch origin master
git reset --hard origin/master
mkdir -p docker-data/agent-avatars
if docker network inspect crm_shared >/dev/null 2>&1; then
  COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.crm-network.yml)
  echo "Using crm_shared overlay."
else
  COMPOSE_FILES=(-f docker-compose.yml)
fi
if [[ ! -f web/.env.local ]]; then
  echo "ERROR: web/.env.local missing"
  exit 1
fi
echo "Building web..."
docker compose "${COMPOSE_FILES[@]}" build --no-cache web
echo "Starting..."
docker compose "${COMPOSE_FILES[@]}" up -d
sleep 8
if curl -sf http://localhost:3001 >/dev/null 2>&1; then
  echo "Health check OK"
else
  echo "Health check FAILED"
  docker compose "${COMPOSE_FILES[@]}" logs --tail=40 web
  exit 1
fi
