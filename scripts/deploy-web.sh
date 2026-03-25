#!/bin/bash
set -e

# =============================================================================
# Deploy Command Central to production (MANUAL FALLBACK)
#
# Standard deploys go through GitHub Actions CI/CD.
# Only use this script for emergency manual deploys.
#
# Usage: bash scripts/deploy-web.sh
# =============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="root@137.184.187.233"
SERVER_REPO="/opt/agent-tim"
DEPLOY_KEY="C:/Users/USER1/.ssh/hetzner_ed25519"

# Use ssh-agent socket
export SSH_AUTH_SOCK=/tmp/tim-agent.sock

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "========================================"
echo "  Deploy Command Central (Manual)"
echo "========================================"
echo ""
echo -e "${YELLOW}WARNING: Standard deploys use GitHub Actions CI/CD.${NC}"
echo -e "${YELLOW}Only use this script for emergency manual deploys.${NC}"
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  exit 0
fi

# ─── Step 1: Local Validation ───────────────────────────────────────────────

echo -e "${YELLOW}[1/4] Validating locally...${NC}"

# Check we're on master
BRANCH=$(cd "$REPO_ROOT" && git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "master" ]; then
  echo -e "${RED}ERROR: Not on master branch (on '$BRANCH'). Switch to master first.${NC}"
  exit 1
fi

# TypeScript check
echo "  Running TypeScript check..."
(cd "$REPO_ROOT/web" && npx tsc --noEmit 2>&1) || {
  echo -e "${RED}ERROR: TypeScript errors found. Fix them before deploying.${NC}"
  exit 1
}
echo -e "  ${GREEN}TypeScript OK${NC}"

# ─── Step 2: Push to GitHub ─────────────────────────────────────────────────

echo ""
echo -e "${YELLOW}[2/4] Pushing to GitHub...${NC}"
(cd "$REPO_ROOT" && git push origin master 2>&1) || {
  echo -e "${RED}ERROR: Git push failed.${NC}"
  exit 1
}
echo -e "  ${GREEN}Pushed to origin/master${NC}"

# ─── Step 3: Build and Deploy with Docker Compose ──────────────────────────

echo ""
echo -e "${YELLOW}[3/4] Building and deploying on server...${NC}"

ssh "$SERVER" bash -s <<'REMOTE_SCRIPT'
set -e

cd /opt/agent-tim

# Pull latest code
echo "  Pulling latest code..."
git fetch origin master
git reset --hard origin/master

# Optional: shared Docker network for Twenty Postgres (docker-compose.crm-network.yml)
if docker network inspect crm_shared >/dev/null 2>&1; then
  COMPOSE_FILES="-f docker-compose.yml -f docker-compose.crm-network.yml"
  echo "  Using crm_shared network overlay for web → Postgres."
else
  COMPOSE_FILES="-f docker-compose.yml"
fi

# Build and restart containers
echo "  Building Docker images..."
docker compose $COMPOSE_FILES build --no-cache web

echo "  Starting containers..."
docker compose $COMPOSE_FILES up -d

echo "  Waiting for server to start..."
sleep 8

# Health check
if curl -sf http://localhost:3001 > /dev/null 2>&1; then
  echo "  ✓ Health check passed"
else
  echo "  ✗ Health check FAILED"
  echo ""
  echo "  Container logs:"
  docker compose $COMPOSE_FILES logs --tail=30 web
  exit 1
fi
REMOTE_SCRIPT

# ─── Step 4: Done ───────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}[4/4] Deploy complete!${NC}"
echo ""
echo "  Site: https://stratt-central.b2bcontentartist.com"
echo ""

# Show recent logs
echo "Recent container logs:"
ssh "$SERVER" 'cd /opt/agent-tim && CF="-f docker-compose.yml"; docker network inspect crm_shared >/dev/null 2>&1 && CF="-f docker-compose.yml -f docker-compose.crm-network.yml"; docker compose $CF logs --tail=5 web' 2>/dev/null || true
echo ""
