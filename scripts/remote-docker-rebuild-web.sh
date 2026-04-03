#!/bin/bash
# Run: Get-Content -Raw scripts/remote-docker-rebuild-web.sh | ssh root@HOST bash -s
set -eu
cd /opt/agent-tim
echo "Pulling latest code..."
git fetch origin master
git reset --hard origin/master
mkdir -p docker-data/agent-avatars
if [[ ! -f web/.env.local ]]; then
  echo "ERROR: web/.env.local missing"
  exit 1
fi
DC=(docker compose --env-file web/.env.local -f docker-compose.yml)
echo "Building web..."
"${DC[@]}" build --no-cache web
echo "Starting..."
"${DC[@]}" up -d
for i in $(seq 1 90); do
  if "${DC[@]}" exec -T crm-db pg_isready -U postgres -d default >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
echo "Ensuring vector memory (pgvector + _memory)..."
"${DC[@]}" exec -T crm-db psql -U postgres -d default -v ON_ERROR_STOP=1 \
  < web/scripts/migrate-vector-memory.sql
echo "Applying idempotent Suzi Intake migration (_intake)..."
"${DC[@]}" exec -T crm-db psql -U postgres -d default -v ON_ERROR_STOP=1 \
  < web/scripts/migrate-intake.sql
echo "Applying idempotent Intake itemNumber (stable card ids)..."
"${DC[@]}" exec -T crm-db psql -U postgres -d default -v ON_ERROR_STOP=1 \
  < web/scripts/migrate-intake-item-number.sql
echo "Applying idempotent punch list actions (JSONB on _punch_list)..."
"${DC[@]}" exec -T crm-db psql -U postgres -d default -v ON_ERROR_STOP=1 \
  < web/scripts/migrate-punch-list-actions-jsonb.sql
if [[ -f tools/expose-crm-db-tailscale.sh ]]; then
  echo "Ensuring CRM Postgres is published on Tailscale (idempotent)..."
  bash tools/expose-crm-db-tailscale.sh || echo "WARN: expose-crm-db-tailscale.sh failed"
fi
sleep 8
if curl -sf http://localhost:3001 >/dev/null 2>&1; then
  echo "Health check OK"
else
  echo "Health check FAILED"
  "${DC[@]}" logs --tail=40 web
  exit 1
fi
