#!/bin/bash
# LinkedIn Integration Tool for Cloud Nanobot Tim
# Uses ConnectSafely API for LinkedIn operations

API_KEY="${CONNECTSAFELY_API_KEY}"
ACCOUNT_ID="${CONNECTSAFELY_ACCOUNT_ID}"
BASE_URL="https://api.connectsafely.ai"

# Helper function for API calls
api_call() {
    local method="$1"
    local endpoint="$2"
    local data="$3"

    if [ -n "$data" ]; then
        curl -s -X "$method" "${BASE_URL}${endpoint}" \
            -H "Authorization: Bearer ${API_KEY}" \
            -H "Content-Type: application/json" \
            -d "$data"
    else
        curl -s -X "$method" "${BASE_URL}${endpoint}" \
            -H "Authorization: Bearer ${API_KEY}"
    fi
}

case "$1" in
    # PROFILE LOOKUP
    lookup-profile)
        # Usage: linkedin.sh lookup-profile "https://linkedin.com/in/username"
        PROFILE_URL="$2"
        api_call GET "/linkedin/profile?url=${PROFILE_URL}"
        ;;

    search-profile)
        # Usage: linkedin.sh search-profile "John Doe"
        NAME="$2"
        api_call GET "/linkedin/profile/search?name=${NAME}"
        ;;

    # MESSAGING
    send-message)
        # Usage: linkedin.sh send-message '{"profileUrl":"...","message":"..."}'
        api_call POST "/linkedin/messaging/send" "$2"
        ;;

    recent-messages)
        # Usage: linkedin.sh recent-messages [limit]
        LIMIT="${2:-20}"
        api_call GET "/linkedin/messaging/recent-messages?limit=${LIMIT}"
        ;;

    # CONNECTIONS
    send-connection)
        # Usage: linkedin.sh send-connection '{"profileUrl":"...","message":"..."}'
        api_call POST "/linkedin/connections/send" "$2"
        ;;

    # ACCOUNT INFO
    account-info)
        api_call GET "/linkedin/account"
        ;;

    *)
        echo "LinkedIn Tool (ConnectSafely API)"
        echo ""
        echo "PROFILES:"
        echo "  lookup-profile <linkedin_url>  - Look up a LinkedIn profile"
        echo "  search-profile <name>          - Search for a profile by name"
        echo ""
        echo "MESSAGING:"
        echo "  send-message <json>            - Send a LinkedIn message"
        echo "  recent-messages [limit]        - Get recent messages"
        echo ""
        echo "CONNECTIONS:"
        echo "  send-connection <json>         - Send a connection request"
        echo ""
        echo "ACCOUNT:"
        echo "  account-info                   - Get account information"
        echo ""
        echo "Rate limits: 120 profiles/day, 100 messages/day, 90 connections/week"
        exit 1
        ;;
esac
