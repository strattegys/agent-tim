#!/bin/bash
# LinkedIn integration via Unipile API

UNIPILE_API_KEY="dIKi/nqp.WSkPX6pJBmPl4nKfI1VnYniXPz8h0dPOIGXA1dKeOcM="
UNIPILE_DSN="api32.unipile.com:16299"
UNIPILE_ACCOUNT_ID="qlL7799BQ_it_e87rbBaFQ"
BASE_URL="https://${UNIPILE_DSN}/api/v1"

ACTION=$1
PROFILE_ID=$2
MESSAGE=$3

# Helper: extract provider_id from various input formats
# Accepts: ACoAAA... (direct), vanity-slug, https://linkedin.com/in/slug-or-ACoAAA
resolve_provider_id() {
  local input="$1"
  # Strip full LinkedIn URL to just the slug/ID
  if [[ "$input" == *"/in/"* ]]; then
    input=$(echo "$input" | sed 's|.*/in/||' | sed 's|/.*||')
  fi
  # If already an ACoAAA provider ID, return directly
  if [[ "$input" =~ ^ACoA ]]; then
    echo "$input"
    return 0
  fi
  # Try to resolve vanity slug via profile lookup
  local PROFILE_JSON
  PROFILE_JSON=$(curl -s -g "$BASE_URL/users/${input}?account_id=${UNIPILE_ACCOUNT_ID}" \
    -H "X-API-KEY: ${UNIPILE_API_KEY}" \
    -H "accept: application/json")
  local RESOLVED
  RESOLVED=$(echo "$PROFILE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('provider_id',''))" 2>/dev/null)
  if [ -n "$RESOLVED" ]; then
    echo "$RESOLVED"
    return 0
  fi
  # Profile lookup failed — return empty
  return 1
}

case "$ACTION" in
  "fetch-profile")
    if [ -z "$PROFILE_ID" ]; then
      echo '{"error": "Profile ID (vanity slug, ACoAAA ID, or LinkedIn URL) is required"}'
      exit 1
    fi
    # Strip URL if provided
    SLUG="$PROFILE_ID"
    if [[ "$SLUG" == *"/in/"* ]]; then
      SLUG=$(echo "$SLUG" | sed 's|.*/in/||' | sed 's|/.*||')
    fi
    curl -s -g "$BASE_URL/users/${SLUG}?account_id=${UNIPILE_ACCOUNT_ID}&linkedin_sections=*" \
      -H "X-API-KEY: ${UNIPILE_API_KEY}" \
      -H "accept: application/json"
    ;;

  "send-message")
    if [ -z "$PROFILE_ID" ] || [ -z "$MESSAGE" ]; then
      echo '{"error": "Recipient (ACoAAA provider ID, vanity slug, or LinkedIn URL) and message are required"}'
      exit 1
    fi
    PROVIDER_ID=$(resolve_provider_id "$PROFILE_ID")
    if [ -z "$PROVIDER_ID" ]; then
      echo "{\"error\": \"Could not resolve '$PROFILE_ID' to a provider_id. Use the ACoAAA provider ID from the CRM contact's LinkedIn URL.\"}"
      exit 1
    fi
    # Send via multipart form (Unipile chat creation)
    curl -s -X POST "$BASE_URL/chats" \
      -H "X-API-KEY: ${UNIPILE_API_KEY}" \
      -H "accept: application/json" \
      -F "account_id=${UNIPILE_ACCOUNT_ID}" \
      -F "attendees_ids=${PROVIDER_ID}" \
      -F "text=${MESSAGE}"
    ;;

  "send-connection")
    if [ -z "$PROFILE_ID" ]; then
      echo '{"error": "Profile ID is required"}'
      exit 1
    fi
    PROVIDER_ID=$(resolve_provider_id "$PROFILE_ID")
    if [ -z "$PROVIDER_ID" ]; then
      echo "{\"error\": \"Could not resolve '$PROFILE_ID' to a provider_id. Use the ACoAAA provider ID or vanity slug.\"}"
      exit 1
    fi
    # Build invite JSON
    JSON=$(python3 -c "
import json, sys
payload = {
    'provider_id': sys.argv[1],
    'account_id': sys.argv[2]
}
if len(sys.argv) > 3 and sys.argv[3]:
    payload['message'] = sys.argv[3]
print(json.dumps(payload))
" "$PROVIDER_ID" "$UNIPILE_ACCOUNT_ID" "$MESSAGE")
    curl -s -X POST "$BASE_URL/users/invite" \
      -H "X-API-KEY: ${UNIPILE_API_KEY}" \
      -H "Content-Type: application/json" \
      -H "accept: application/json" \
      -d "$JSON"
    ;;

  "recent-messages")
    LIMIT="${PROFILE_ID:-20}"
    curl -s -g "$BASE_URL/chats?account_id=${UNIPILE_ACCOUNT_ID}&account_type=LINKEDIN&limit=${LIMIT}" \
      -H "X-API-KEY: ${UNIPILE_API_KEY}" \
      -H "accept: application/json"
    ;;

  "account-info")
    curl -s -g "$BASE_URL/accounts" \
      -H "X-API-KEY: ${UNIPILE_API_KEY}" \
      -H "accept: application/json"
    ;;

  "get-chat-messages")
    # Extra command: get messages from a specific chat
    if [ -z "$PROFILE_ID" ]; then
      echo '{"error": "Chat ID is required"}'
      exit 1
    fi
    curl -s -g "$BASE_URL/chats/${PROFILE_ID}/messages" \
      -H "X-API-KEY: ${UNIPILE_API_KEY}" \
      -H "accept: application/json"
    ;;

  *)
    echo "Usage: $0 {fetch-profile|send-message|send-connection|recent-messages|account-info|get-chat-messages} <profile-id> [message]"
    exit 1
    ;;
esac
