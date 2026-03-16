#!/usr/bin/env bash
# Run AvaBot locally for development — http://localhost:18792
# Usage: bash run_avabot_local.sh

set -e
cd "$(dirname "$0")"

export AVABOT_DIR="$(pwd)/avabot_local"
export GEMINI_API_KEY="AIzaSyBnvMRkvOy5NM82WMEdfrKY_xrMjCLMbuc"

# Telegram tokens — relay to real bots even in local dev
export TIM_TOKEN="8784616714:AAEAeJJ25_ypScrEJvEl2QFwgHC51-7HATw"
export SUZI_TOKEN="8794442167:AAFw5diNYKgUTlJ7zGzp827JahN2yt_-9-A"
export GOVIND_CHAT_ID="5289013326"
export SUSAN_CHAT_ID="8093839106"

echo "Starting AvaBot locally..."
echo "  AVABOT_DIR: $AVABOT_DIR"
echo "  Open: http://localhost:18792"
echo ""

.venv/Scripts/python avabot_server.py
