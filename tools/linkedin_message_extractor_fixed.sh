#!/bin/bash

# LinkedIn Message Extractor - Fixed Cursor Logic

# Configuration
CONNECTSAFELY_API_KEY="1df1fdda-51e5-46c1-8a97-99dde05a11d1"
CONNECTSAFELY_ACCOUNT_ID="699fbf3eb09b5425c73d4b81"
BASE_URL="https://api.connectsafely.ai"
STATE_FILE="/root/.nanobot/linkedin_message_state.json"
TWENTY_CRM_TOOL="/root/.nanobot/tools/twenty_crm.sh"
ALERT_LOG="/root/.nanobot/linkedin_alerts.log"

# Optional: Limit messages for testing
MESSAGE_LIMIT="${1:-5}"

echo "🔍 Fixed LinkedIn Message Extractor - Processing newest messages only"

# Get current timestamp in milliseconds (24 hours ago)
CURRENT_TIME=$(date +%s)000
TIME_LIMIT=$((CURRENT_TIME - 24 * 60 * 60 * 1000))  # 24 hours ago

echo "📅 Processing messages newer than: $(date -d @$(($TIME_LIMIT / 1000)) '+%Y-%m-%d %H:%M:%S')"

# Fetch messages without cursor (always get newest)
API_URL="${BASE_URL}/linkedin/messaging/recent-messages?limit=${MESSAGE_LIMIT}"

echo "📡 Fetching messages from: $API_URL"
RESPONSE=$(curl -s -X GET "${API_URL}" \
  -H "Authorization: Bearer ${CONNECTSAFELY_API_KEY}" \
  -H "Content-Type: application/json")

if [ $? -ne 0 ] || [ -z "$RESPONSE" ]; then
    echo "❌ Failed to fetch messages"
    exit 1
fi

# Check for errors
API_SUCCESS=$(echo "$RESPONSE" | jq -r '.success // true')
if [ "$API_SUCCESS" != "true" ]; then
    echo "❌ API error: $(echo "$RESPONSE" | jq -r '.error // "Unknown error"')"
    exit 1
fi

CONVERSATIONS=$(echo "$RESPONSE" | jq -c '.conversations[]')
if [ -z "$CONVERSATIONS" ]; then
    echo "📭 No conversations found"
    exit 0
fi

echo "📝 Found $(echo "$RESPONSE" | jq '.conversations | length') conversations"

# Process each conversation
MESSAGE_COUNT=0
echo "$CONVERSATIONS" | while IFS= read -r conversation; do
    CONVERSATION_ID=$(echo "$conversation" | jq -r '.conversationId')
    SENDER_NAME=$(echo "$conversation" | jq -r '.latestMessage.senderName // "Unknown Sender"')
    MESSAGE_TEXT=$(echo "$conversation" | jq -r '.latestMessage.text // "No message text"')
    TIMESTAMP_MS=$(echo "$conversation" | jq -r '.latestMessage.sentAt // 0')
    
    # Convert timestamp to human-readable format
    TIMESTAMP_SEC=$(($TIMESTAMP_MS / 1000))
    HUMAN_READABLE_TIMESTAMP=$(date -d "@$TIMESTAMP_SEC" "+%Y-%m-%d %H:%M:%S")
    
    echo "🔍 Checking: $CONVERSATION_ID from $SENDER_NAME at $HUMAN_READABLE_TIMESTAMP"
    
    # Skip messages older than 24 hours
    if [ "$TIMESTAMP_MS" -lt "$TIME_LIMIT" ]; then
        echo "⏭️  Skipping old message (more than 24 hours old)"
        continue
    fi
    
    # Check if already processed (simple check)
    if bash "$TWENTY_CRM_TOOL" list-notes 2>/dev/null | jq -r '.[] | select(.bodyV2.markdown and (.bodyV2.markdown | contains("'$CONVERSATION_ID'"))) | .id' | grep -q .; then
        echo "✅ Already processed, skipping"
        continue
    fi
    
    echo "📨 Processing new message from $SENDER_NAME"
    
    # Create note for the message
    NOTE_TITLE="LinkedIn Message from ${SENDER_NAME}"
    
    # Clean up message text and escape for JSON
    CLEAN_MESSAGE=$(echo "$MESSAGE_TEXT" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
    CLEAN_SENDER=$(echo "$SENDER_NAME" | sed 's/"/\\"/g')
    CLEAN_PROFILE=$(echo "$conversation" | jq -r '.latestMessage.senderProfileUrl // empty' | sed 's/"/\\"/g')
    
    NOTE_CONTENT="${CLEAN_MESSAGE}\\n\\n**From:** ${CLEAN_SENDER}\\n**Date:** ${HUMAN_READABLE_TIMESTAMP}\\n**Conversation ID:** ${CONVERSATION_ID}\\n\\n**LinkedIn Profile:** ${CLEAN_PROFILE}"
    
    NOTE_PAYLOAD="{\"title\":\"${NOTE_TITLE}\",\"bodyV2\":{\"markdown\":\"${NOTE_CONTENT}\"}}"
    
    echo "📝 Creating note..."
    NOTE_RESPONSE=$(bash "$TWENTY_CRM_TOOL" create-note "$NOTE_PAYLOAD")
    
    if echo "$NOTE_RESPONSE" | jq -e '.data.createNote.id' >/dev/null 2>&1; then
        NOTE_ID=$(echo "$NOTE_RESPONSE" | jq -r '.data.createNote.id')
        echo "✅ Created note: $NOTE_ID"
        
        # Send alert for non-GMoney messages
        if [[ "$SENDER_NAME" != "Govind Davis" ]]; then
            ALERT_MESSAGE="🔔 ${HUMAN_READABLE_TIMESTAMP} PT - ${SENDER_NAME}: ${MESSAGE_TEXT:0:100}... [$(echo "$conversation" | jq -r '.latestMessage.senderProfileUrl // empty')]"
            echo "$ALERT_MESSAGE" >> "$ALERT_LOG"
            echo "🔔 Alert sent for message from $SENDER_NAME"
        else
            echo "🤫 GMoney's message - no alert sent"
        fi
        
        MESSAGE_COUNT=$((MESSAGE_COUNT + 1))
    else
        echo "❌ Failed to create note: $NOTE_RESPONSE"
    fi
    
    echo "---"
done

echo ""
echo "🎉 Processing complete!"
echo "📊 Processed $MESSAGE_COUNT new messages"
echo "📄 Check alerts in: $ALERT_LOG"

# Update cursor to current time (for next run)
echo "{\"last_cursor\": \"$(date +%s)000\", \"processed_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$STATE_FILE"
echo "💾 Updated cursor state"
