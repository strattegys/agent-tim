#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Tim Web Chat Deployment ==="

# 1. Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: Node.js not found. Install Node.js 18+."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm not found."; exit 1; }

echo "[1/6] Prerequisites OK (Node $(node --version))"

# 2. Check .env.local
if [ ! -f .env.local ]; then
  echo "Error: .env.local not found. Copy .env.local.example and fill in your values:"
  echo "  cp .env.local.example .env.local"
  echo "  nano .env.local"
  exit 1
fi
echo "[2/6] .env.local found"

# 3. Install dependencies
echo "[3/6] Installing dependencies..."
npm install --production=false

# 4. Build
echo "[4/6] Building Next.js app..."
npm run build

# 5. Install PM2 if needed
if ! command -v pm2 >/dev/null 2>&1; then
  echo "[5/6] Installing PM2..."
  npm install -g pm2
else
  echo "[5/6] PM2 already installed"
fi

# 6. Start/restart with PM2
if pm2 describe tim-web >/dev/null 2>&1; then
  echo "[6/6] Restarting tim-web..."
  pm2 restart tim-web --update-env
else
  echo "[6/6] Starting tim-web..."
  pm2 start ecosystem.config.js
fi

pm2 save

echo ""
echo "=== Deployment Complete ==="
echo "Tim Web Chat is running on http://localhost:3001"
echo ""
echo "Next steps:"
echo "  1. Set up nginx reverse proxy (see nginx.conf.example)"
echo "  2. Point tim-bot.b2bcontentartist.com DNS to this server"
echo "  3. Set up SSL with: sudo certbot --nginx -d tim-bot.b2bcontentartist.com"
echo "  4. Run 'pm2 startup' to auto-start on reboot"
echo ""
echo "Useful commands:"
echo "  pm2 logs tim-web        # View logs"
echo "  pm2 restart tim-web     # Restart"
echo "  pm2 stop tim-web        # Stop"
