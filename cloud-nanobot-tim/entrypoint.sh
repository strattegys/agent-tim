#!/bin/bash
set -e

# Prevent nanobot from auto-detecting Anthropic and using assistant prefill
# (Claude 4.6 removed prefill support, causing 400 errors)
unset ANTHROPIC_API_KEY

CONFIG_FILE="/root/.nanobot/config.json"

# Substitute environment variables in config.json
envsubst < "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"

# Substitute environment variables in tool scripts
for tool in /root/.nanobot/tools/*.sh; do
    envsubst < "$tool" > "${tool}.tmp" && mv "${tool}.tmp" "$tool"
    chmod +x "$tool"
done

# --- Connectivity checks ---
echo "=== Nanobot Tim Startup ==="

# Check CRM
CRM_URL="${TWENTY_CRM_URL:-http://localhost:3000}"
if curl -sf "${CRM_URL}/healthz" > /dev/null 2>&1; then
    echo "[OK] Twenty CRM reachable at ${CRM_URL}"
else
    echo "[WARN] Twenty CRM not reachable at ${CRM_URL} - CRM tools may fail"
fi

# Check Telegram token
if [ -n "${TELEGRAM_BOT_TOKEN}" ] && [ "${TELEGRAM_BOT_TOKEN}" != "your_telegram_bot_token_here" ]; then
    echo "[OK] Telegram bot token configured"
else
    echo "[WARN] Telegram bot token not set"
fi

# Check Gemini
if [ -n "${GEMINI_API_KEY}" ] && [ "${GEMINI_API_KEY}" != "your_gemini_api_key_here" ]; then
    echo "[OK] Gemini API key configured"
else
    echo "[WARN] Gemini API key not set"
fi

# Check LinkedIn
if [ -n "${CONNECTSAFELY_API_KEY}" ] && [ "${CONNECTSAFELY_API_KEY}" != "your_connectsafely_api_key_here" ]; then
    echo "[OK] LinkedIn (ConnectSafely) configured"
else
    echo "[--] LinkedIn not configured (optional)"
fi

# Check Brave Search
if [ -n "${BRAVE_SEARCH_API_KEY}" ] && [ "${BRAVE_SEARCH_API_KEY}" != "your_brave_search_api_key_here" ]; then
    echo "[OK] Brave Search configured"
else
    echo "[--] Brave Search not configured (optional)"
fi

echo "=========================="
echo "Starting Nanobot Tim..."
exec nanobot gateway
