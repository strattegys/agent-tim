#!/bin/bash

# LinkedIn Message Extractor for Nanobot - Fixed Version

# Configuration
CONNECTSAFELY_API_KEY="1df1fdda-51e5-46c1-8a97-99dde05a11d1"
CONNECTSAFELY_ACCOUNT_ID="699fbf3eb09b5425c73d4b81"
BASE_URL="https://api.connectsafely.ai"
STATE_FILE="/root/.nanobot/linkedin_message_state.json"
TWENTY_CRM_TOOL="/root/.nanobot/tools/twenty_crm.sh"
ALERT_LOG="/root/.nanobot/linkedin_alerts.log"

# Optional: Limit messages for testing
MESSAGE_LIMIT="${1:-}" # Pass limit as first argument, e.g., '5'

# Function to read state (last_cursor)
get_last_cursor() {
    if [ -f "$STATE_FILE" ]; then
        jq -r '.last_cursor // empty' "$STATE_FILE"
    else
        echo ""
    fi
}

# Function to save state (last_cursor)
save_last_cursor() {
    local new_cursor="$1"
    jq -n --arg cursor "$new_cursor" '{"last_cursor": $cursor}' > "$STATE_FILE"
}

# Function to extract recipient name from message text
extract_recipient_name() {
    local message_text="$1"
    # Extract name from "Hey Name," pattern at the beginning of message
    echo "$message_text" | grep -o '^Hey [^,]*,' | sed 's/^Hey //' | sed 's/,//' | head -1
}

# Function to check if sender is GMoney
is_gmoney() {
    local sender_name="$1"
    # Check if sender is Govind Davis (GMoney)
    [[ "$sender_name" == "Govind Davis" ]]
}

# Function to convert \n to actual line breaks in markdown
convert_line_breaks() {
    local content="$1"
    # Convert literal \n to actual newlines for markdown
    echo "$content" | sed 's/\\n/\n/g'
}

# Function to send alert to GMoney
send_alert() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Log the alert
    echo "[$timestamp] $message" >> "$ALERT_LOG"
    
    # Send to Telegram (if configured)
    if [ -f "/root/.nanobot/config.json" ]; then
        TELEGRAM_TOKEN=$(jq -r '.channels.telegram.token' /root/.nanobot/config.json)
        if [ "$TELEGRAM_TOKEN" != "null" ] && [ -n "$TELEGRAM_TOKEN" ]; then
            # Send alert via curl to Telegram
            curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" \
                -d chat_id="5289013326" \
                -d text="🔔 LinkedIn Alert: $message" \
                -d parse_mode="Markdown" > /dev/null
        fi
    fi
    
    echo "🔔 ALERT: $message"
}

# Function to find or create a contact in Twenty CRM
# Arguments: $1 = full_name, $2 = linkedin_profile_url (optional)
find_or_create_contact() {
    local full_name="$1"
    local linkedin_profile_url="$2"
    local first_name=""
    local last_name=""
    local contact_id=""

    # Split full name into first and last name
    first_name=$(echo "$full_name" | awk '{print $1}')
    # Handle multi-word last names
    last_name=$(echo "$full_name" | awk '{split($0,a," "); for(i=2;i<=length(a);i++) printf "%s%s", a[i], (i==length(a)?"":" ")}')
    
    if [ -z "$last_name" ]; then
        last_name="" # Leave empty if only one name provided
    fi

    # 1. Try to find contact by LinkedIn profile URL (if available)
    if [ -n "$linkedin_profile_url" ]; then
        SEARCH_RESPONSE=$("$TWENTY_CRM_TOOL" search-contacts "$full_name")
        contact_id=$(echo "$SEARCH_RESPONSE" | jq -r '.[] | select(.linkedinLink.primaryLinkUrl == "'"$linkedin_profile_url"'") | .id // empty')
        if [ -n "$contact_id" ]; then
            echo "Found existing contact by LinkedIn URL: ${full_name} (ID: ${contact_id})" >&2
            echo "$contact_id"
            return 0
        fi
    fi

    # 2. Try to find contact by name
    SEARCH_RESPONSE=$("$TWENTY_CRM_TOOL" search-contacts "$full_name")
    MATCHES=$(echo "$SEARCH_RESPONSE" | jq -c '.[] | select(.name.firstName == "'"$first_name"'" and .name.lastName == "'"$last_name"'")')

    if [ -n "$MATCHES" ]; then
        contact_id=$(echo "$MATCHES" | jq -r '.[0].id')
        echo "Found existing contact by name: ${full_name} (ID: ${contact_id})" >&2
    else
        echo "Contact ${full_name} not found. Creating new contact..." >&2
        
        # Create contact with LinkedIn profile if available
        if [ -n "$linkedin_profile_url" ]; then
            CREATE_PAYLOAD=$(jq -n --arg fn "$first_name" --arg ln "$last_name" --arg url "$linkedin_profile_url" \
                '{"name": {"firstName": $fn, "lastName": $ln}, "linkedinLink": {"primaryLinkUrl": $url, "primaryLinkLabel": "LinkedIn"}}')
        else
            # Handle case where last_name might be empty
            if [ -n "$last_name" ]; then
                CREATE_PAYLOAD=$(jq -n --arg fn "$first_name" --arg ln "$last_name" \
                    '{"name": {"firstName": $fn, "lastName": $ln}}')
            else
                CREATE_PAYLOAD=$(jq -n --arg fn "$first_name" \
                    '{"name": {"firstName": $fn, "lastName": ""}}')
            fi
        fi
        
        CREATE_RESPONSE=$("$TWENTY_CRM_TOOL" create-contact "$CREATE_PAYLOAD")

        contact_id=$(echo "$CREATE_RESPONSE" | jq -r '.data.createPerson.id // empty')
        if [ -n "$contact_id" ]; then
            echo "Created new contact: ${full_name} (ID: ${contact_id})" >&2
        else
            echo "Error creating contact ${full_name}. Response: ${CREATE_RESPONSE}" >&2
            return 1 # Indicate failure
        fi
    fi

    echo "$contact_id" # Return the contact ID
    return 0
}

# Function to create note and link to contact
create_linked_note() {
    local contact_id="$1"
    local title="$2"
    local content="$3"
    
    # Create note
    NOTE_PAYLOAD=$(jq -n --arg title "$title" --arg content "$content" \
        '{"title": $title, "bodyV2": {"markdown": $content}}')
    
    NOTE_RESPONSE=$("$TWENTY_CRM_TOOL" create-note "$NOTE_PAYLOAD")
    NOTE_ID=$(echo "$NOTE_RESPONSE" | jq -r '.data.createNote.id // empty')
    
    if [ -n "$NOTE_ID" ]; then
        # Link note to contact using NoteTarget
        TARGET_PAYLOAD=$(jq -n --arg note_id "$NOTE_ID" --arg contact_id "$contact_id" \
            '{"noteId": $note_id, "targetPersonId": $contact_id}')
        
        TARGET_RESPONSE=$("$TWENTY_CRM_TOOL" create-note-target "$TARGET_PAYLOAD")
        echo "Created and linked note: ${NOTE_ID}" >&2
        return 0
    else
        echo "Error creating note. Response: ${NOTE_RESPONSE}" >&2
        return 1
    fi
}

# Main execution
LAST_CURSOR=$(get_last_cursor)

echo "Fetching LinkedIn messages. Last cursor: ${LAST_CURSOR}"

# Construct the API URL with optional nextCursor and limit
API_URL="${BASE_URL}/linkedin/messaging/recent-messages"
PARAMS=""
if [ -n "$LAST_CURSOR" ]; then
    PARAMS="nextCursor=${LAST_CURSOR}"
fi
if [ -n "$MESSAGE_LIMIT" ]; then
    if [ -n "$PARAMS" ]; then
        PARAMS="${PARAMS}&"
    fi
    PARAMS="${PARAMS}limit=${MESSAGE_LIMIT}"
fi
if [ -n "$PARAMS" ]; then
    API_URL="${API_URL}?${PARAMS}"
fi

# Make the API call
RESPONSE=$(curl -s -X GET "${API_URL}" \
  -H "Authorization: Bearer ${CONNECTSAFELY_API_KEY}" \
  -H "Content-Type: application/json")

# Check for errors in API response
API_SUCCESS=$(echo "$RESPONSE" | jq -r '.success')

if [ "$API_SUCCESS" != "true" ]; then
    echo "Error fetching messages: $(echo "$RESPONSE" | jq -r '.error // "Unknown error"') " >&2
    send_alert "Failed to fetch LinkedIn messages: $(echo "$RESPONSE" | jq -r '.error // "Unknown error"')"
    exit 1
fi

NEW_CURSOR=$(echo "$RESPONSE" | jq -r '.nextCursor // empty')
CONVERSATIONS=$(echo "$RESPONSE" | jq -c '.conversations[]')

if [ -z "$CONVERSATIONS" ]; then
    echo "No new conversations found."
else
    echo "Found new conversations. Processing..."
    MESSAGE_COUNT=0
    
    echo "$CONVERSATIONS" | while IFS= read -r conversation; do
        CONVERSATION_ID=$(echo "$conversation" | jq -r '.conversationId')
        SENDER_NAME=$(echo "$conversation" | jq -r '.latestMessage.senderName // "Unknown Sender"')
        MESSAGE_TEXT=$(echo "$conversation" | jq -r '.latestMessage.text // "No message text"')
        TIMESTAMP_MS=$(echo "$conversation" | jq -r '.latestMessage.sentAt // 0') # Unix timestamp in milliseconds
        SENDER_PROFILE_URL=$(echo "$conversation" | jq -r '.latestMessage.senderProfileUrl // empty')

        # Convert timestamp to human-readable format
        TIMESTAMP_SEC=$(($TIMESTAMP_MS / 1000))
        HUMAN_READABLE_TIMESTAMP=$(date -d "@$TIMESTAMP_SEC" "+%Y-%m-%d %H:%M:%S")

        # Check if sender is GMoney
        if is_gmoney "${SENDER_NAME}"; then
            echo "--- GMoney's Message (no alert) ---"
            echo "Conversation ID: ${CONVERSATION_ID}"
            echo "From: ${SENDER_NAME} (GMoney)"
            echo "Message: ${MESSAGE_TEXT}"
            echo "Timestamp: ${HUMAN_READABLE_TIMESTAMP}"
            echo "-------------------"
            
            # Extract recipient name from message
            RECIPIENT_NAME=$(extract_recipient_name "${MESSAGE_TEXT}")
            if [ -n "$RECIPIENT_NAME" ] && [ "$RECIPIENT_NAME" != "" ]; then
                echo "Extracted recipient: ${RECIPIENT_NAME}"
                
                # Create contact for recipient (no LinkedIn profile available)
                CONTACT_ID=$(find_or_create_contact "${RECIPIENT_NAME}" "")
                if [ -z "$CONTACT_ID" ]; then
                    echo "Failed to find or create contact for recipient ${RECIPIENT_NAME}. Skipping note creation." >&2
                    continue
                fi
                
                NOTE_TITLE="LinkedIn Message to ${RECIPIENT_NAME}"
                NOTE_CONTENT="**From:** ${SENDER_NAME}\\n**Date:** ${HUMAN_READABLE_TIMESTAMP}\\n**Conversation ID:** ${CONVERSATION_ID}\\n\\n**Message:**\\n${MESSAGE_TEXT}\\n\\n**LinkedIn Profile:** ${SENDER_PROFILE_URL}"
                
                # Convert line breaks for proper markdown formatting
                FORMATTED_CONTENT=$(convert_line_breaks "${NOTE_CONTENT}")
                
                # Create note and link to recipient contact (no alert)
                if create_linked_note "${CONTACT_ID}" "${NOTE_TITLE}" "${FORMATTED_CONTENT}"; then
                    MESSAGE_COUNT=$((MESSAGE_COUNT + 1))
                    echo "Logged GMoney's message to ${RECIPIENT_NAME} (no alert sent)"
                else
                    echo "Failed to create note for GMoney's message to ${RECIPIENT_NAME}" >&2
                fi
            else
                echo "Could not extract recipient name from GMoney's message. Skipping note creation." >&2
            fi
        else
            echo "--- New Message ---"
            echo "Conversation ID: ${CONVERSATION_ID}"
            echo "From: ${SENDER_NAME}"
            echo "Message: ${MESSAGE_TEXT}"
            echo "Timestamp: ${HUMAN_READABLE_TIMESTAMP}"
            echo "-------------------"

            # Find or create contact for sender
            CONTACT_ID=$(find_or_create_contact "${SENDER_NAME}" "${SENDER_PROFILE_URL}")
            if [ -z "$CONTACT_ID" ]; then
                echo "Failed to find or create contact for ${SENDER_NAME}. Skipping note creation." >&2
                continue
            fi

            NOTE_TITLE="LinkedIn Message from ${SENDER_NAME}"
            NOTE_CONTENT="**From:** ${SENDER_NAME}\\n**Date:** ${HUMAN_READABLE_TIMESTAMP}\\n**Conversation ID:** ${CONVERSATION_ID}\\n\\n**Message:**\\n${MESSAGE_TEXT}\\n\\n**LinkedIn Profile:** ${SENDER_PROFILE_URL}"
            
            # Convert line breaks for proper markdown formatting
            FORMATTED_CONTENT=$(convert_line_breaks "${NOTE_CONTENT}")

            # Create note and link to contact with alert
            if create_linked_note "${CONTACT_ID}" "${NOTE_TITLE}" "${FORMATTED_CONTENT}"; then
                MESSAGE_COUNT=$((MESSAGE_COUNT + 1))
                send_alert "New LinkedIn message from ${SENDER_NAME}: ${MESSAGE_TEXT:0:100}..."
            else
                echo "Failed to create note for message from ${SENDER_NAME}" >&2
            fi
        fi
    done
    
    if [ $MESSAGE_COUNT -gt 0 ]; then
        send_alert "Processed ${MESSAGE_COUNT} new LinkedIn messages and added them to Twenty CRM"
    fi

    if [ -n "$NEW_CURSOR" ]; then
        save_last_cursor "$NEW_CURSOR"
        echo "Updated last cursor to: ${NEW_CURSOR}"
    else
        echo "No new cursor returned, keeping previous state."
    fi
fi

exit 0
