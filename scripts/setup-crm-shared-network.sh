#!/usr/bin/env bash
# Run on the production droplet (SSH as root). Sets up Option A: shared Docker network
# between Command Central (web) and Twenty/CRM Postgres.
#
# Usage:  cd /opt/agent-tim && bash scripts/setup-crm-shared-network.sh

set -euo pipefail

if ! docker network inspect crm_shared >/dev/null 2>&1; then
  docker network create crm_shared
  echo "Created docker network: crm_shared"
else
  echo "Network crm_shared already exists."
fi

echo ""
echo "Postgres / DB containers (use the one that holds Twenty CRM / database \"default\"):"
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"

echo ""
echo "=== Next steps (Option A) ==="
echo "1) Attach Postgres to the shared network (replace CONTAINER):"
echo "     docker network connect crm_shared CONTAINER"
echo ""
echo "2) Set in /opt/agent-tim/web/.env.local:"
echo "     CRM_DB_HOST=CONTAINER    # exact name from docker ps"
echo "     CRM_DB_PORT=5432"
echo "     CRM_DB_NAME=default      # if that is your Twenty DB"
echo "     CRM_DB_USER=postgres"
echo "     CRM_DB_PASSWORD=..."
echo ""
echo "3) Redeploy Command Central:"
echo "     cd /opt/agent-tim"
echo "     docker compose -f docker-compose.yml -f docker-compose.crm-network.yml up -d"
echo "     (GitHub Actions also picks up docker-compose.crm-network.yml when crm_shared exists.)"
echo ""
echo "4) Verify: Command Central UI → Status rail → Data platform = OK."
