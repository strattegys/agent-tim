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
    local sender_name="$2"
    
    # Check if this is a connection acceptance message
    if [[ "$message_text" == *"hoping we can connect"* ]] && [[ "$message_text" == *"It would be an honor to join your network"* ]]; then
        # This is a connection acceptance - extract recipient from the first line
        # Format: "Hi Name, hoping we can connect..."
        local recipient=$(echo "$message_text" | grep -o '^Hi [^,]*,' | sed 's/^Hi //' | sed 's/,//' | head -1)
        echo "$recipient"
    else
        # Regular message - extract from "Hey Name," pattern
        local extracted_name=$(echo "$message_text" | grep -o '^Hey [^,]*,' | sed 's/^Hey //' | sed 's/,//' | head -1)
        
        if [ -n "$extracted_name" ]; then
            echo "$extracted_name"
        else
            # Try other patterns
            echo "$message_text" | grep -o '^Hi [^,]*,' | sed 's/^Hi //' | sed 's/,//' | head -1
        fi
    fi
}

# Function to get full name for recipient
get_full_recipient_name() {
    local first_name="$1"
    local mapping_file="/root/.nanobot/recipient_mappings.json"
    
    if [ -f "$mapping_file" ]; then
        local full_name=$(jq -r ".mappings.\"$first_name\" // \"$first_name\"" "$mapping_file")
        echo "$full_name"
    else
        echo "$first_name"
    fi
}

# Function to try to find LinkedIn profile for recipient name
find_linkedin_profile() {
    local name="$1"
    # This is a placeholder - in a real implementation, you might:
    # 1. Search LinkedIn API for the name
    # 2. Use a people search service
    # 3. Maintain a mapping of known contacts
    # For now, return empty since we don't have recipient LinkedIn data
    echo ""
}

# Function to check if sender is GMoney
is_gmoney() {
    local sender_name="$1"
    # Check if sender is Govind Davis (GMoney)
    [[ "$sender_name" == "Govind Davis" ]]
}

# Function to check if this is an emoji reaction (not a connection request)
is_emoji_reaction() {
    local message_text="$1"
    
    # Check for common emoji reactions
    if [[ "$message_text" =~ ^[👍👎❤️😂😮😢🔥]$ ]]; then
        echo "Emoji reaction detected: $message_text"
        return 0
    fi
    
    return 1
}

# Function to check if this is a connection request message
is_connection_request() {
    local message_text="$1"
    local sender_name="$2"
    local participant_count="$3"
    local participant_name="$4"
    
    # Skip if it's an emoji reaction
    if is_emoji_reaction "$message_text"; then
        return 1
    fi
    
    # Structural detection: Single participant + sender == participant = connection request
    # (API incorrectly reports recipient as sender for connection requests)
    if [[ "$participant_count" == "1" ]] && [[ "$sender_name" == "$participant_name" ]]; then
        echo "Structural detection: Connection request (sender: $sender_name, participant: $participant_name)"
        return 0
    fi
    
    # Fallback: Pattern-based detection for edge cases
    if [[ "$message_text" == *"hoping we can connect"* ]] && [[ "$message_text" == *"It would be an honor to join your network"* ]]; then
        echo "Pattern detection: Connection request"
        return 0
    fi
    
    # Additional pattern: Business Content Artist connection requests
    if [[ "$message_text" == *"as a Business Content Artist, I'm looking to help B2B SaaS and tech brands"* ]] && [[ "$message_text" == *"I'm looking to connect with innovative marketing leaders"* ]]; then
        echo "Pattern detection: Business Content Artist connection request"
        return 0
    fi
    
    return 1
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
echo "Fetching LinkedIn messages (starting from newest)"

# Always start without cursor to get newest messages
API_URL="${BASE_URL}/linkedin/messaging/recent-messages"
PARAMS=""
if [ -n "$MESSAGE_LIMIT" ]; then
    PARAMS="limit=${MESSAGE_LIMIT}"
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
    # Track processed conversation IDs to avoid duplicates
    declare -A processed_conversations

    # Check if conversation was already processed
    is_already_processed() {
        local conversation_id="$1"
        # Check if a note already exists for this conversation ID
        local existing_note=$(bash "$TWENTY_CRM_TOOL" list-notes 2>/dev/null | jq -r '.[] | select(.bodyV2.markdown and (.bodyV2.markdown | contains("'$conversation_id'"))) | .id // empty')
        if [ -n "$existing_note" ] && [ "$existing_note" != "null" ]; then
            echo "Conversation $conversation_id already processed - stopping batch"
            return 0
        fi
        return 1
    }

# Check if contact already exists by LinkedIn profile (handle ID mismatch)
find_contact_by_linkedin_url() {
    local linkedin_url="$1"
    local search_name="$2"
    
    if [ -n "$linkedin_url" ]; then
        # First try to find by exact LinkedIn URL match
        local exact_match=$(bash "$TWENTY_CRM_TOOL" search-contacts "$search_name" 2>/dev/null | jq -r '.[] | select(.linkedinLink.primaryLinkUrl == "'"$linkedin_url"'") | .id // empty')
        if [ -n "$exact_match" ]; then
            echo "$exact_match"
            return 0
        fi
        
        # If no exact match, try to find contacts with LinkedIn profiles for this name
        local contacts_with_linkedin=$(bash "$TWENTY_CRM_TOOL" search-contacts "$search_name" 2>/dev/null | jq -r '.[] | select(.linkedinLink.primaryLinkUrl) | {id: .id, url: .linkedinLink.primaryLinkUrl}')
        
        if [ -n "$contacts_with_linkedin" ]; then
            # Return the first contact with LinkedIn profile (they might be the same person with different ID format)
            echo "$contacts_with_linkedin" | jq -r '.id' | head -1
            return 0
        fi
    fi
    
    return 1
}

    echo "Found new conversations. Processing..."
    MESSAGE_COUNT=0
    
    echo "$CONVERSATIONS" | while IFS= read -r conversation; do
        CONVERSATION_ID=$(echo "$conversation" | jq -r '.conversationId')
        SENDER_NAME=$(echo "$conversation" | jq -r '.latestMessage.senderName // "Unknown Sender"')
        MESSAGE_TEXT=$(echo "$conversation" | jq -r '.latestMessage.text // "No message text"')
        TIMESTAMP_MS=$(echo "$conversation" | jq -r '.latestMessage.sentAt // 0')
        
        # Convert timestamp to human-readable format
        TIMESTAMP_SEC=$(($TIMESTAMP_MS / 1000))
        HUMAN_READABLE_TIMESTAMP=$(date -d "@$TIMESTAMP_SEC" "+%Y-%m-%d %H:%M:%S")
        
        echo "Checking conversation: $CONVERSATION_ID from $SENDER_NAME at $HUMAN_READABLE_TIMESTAMP"
        
        if is_already_processed "$CONVERSATION_ID"; then
            echo "✅ Stopping - conversation $CONVERSATION_ID already processed"
            break
        fi
        
        # Extract participant information for structural detection
        PARTICIPANT_COUNT=$(echo "$conversation" | jq '.participants | length')
        PARTICIPANT_NAME=$(echo "$conversation" | jq -r '.participants[0].name // empty')

        # Check if this is a connection request (using structural detection)
        if is_connection_request "${MESSAGE_TEXT}" "${SENDER_NAME}" "${PARTICIPANT_COUNT}" "${PARTICIPANT_NAME}"; then
            echo "--- Connection Request (GMoney's - no alert) ---"
            echo "Conversation ID: ${CONVERSATION_ID}"
            echo "From: ${SENDER_NAME} (actually GMoney's connection request)"
            echo "Message: ${MESSAGE_TEXT}"
            echo "Timestamp: ${HUMAN_READABLE_TIMESTAMP}"
            echo "-------------------"
            
            # Use participant name as recipient (more reliable than parsing message text)
            if [ -n "$PARTICIPANT_NAME" ] && [ "$PARTICIPANT_NAME" != "" ]; then
                echo "Recipient (from participant): ${PARTICIPANT_NAME}"
                
                # Get full name for recipient
                RECIPIENT_NAME=$(get_full_recipient_name "${PARTICIPANT_NAME}")
                echo "Full recipient name: ${RECIPIENT_NAME}"
                
                # Create contact for recipient (no LinkedIn profile)
                CONTACT_ID=$(find_or_create_contact "${RECIPIENT_NAME}" "")
                if [ -z "$CONTACT_ID" ]; then
                    echo "Failed to find or create contact for recipient ${RECIPIENT_NAME}. Skipping note creation." >&2
                    continue
                fi
                
                NOTE_TITLE="LinkedIn Connection Request to ${RECIPIENT_NAME}"
                NOTE_CONTENT="${MESSAGE_TEXT}\\n\\n**Type:** Connection Request\\n**From:** Govind Davis\\n**Date:** ${HUMAN_READABLE_TIMESTAMP}\\n**Conversation ID:** ${CONVERSATION_ID}\\n\\n**LinkedIn Profile:** ${SENDER_PROFILE_URL}"
                
                # Convert line breaks for proper markdown formatting
                FORMATTED_CONTENT=$(convert_line_breaks "${NOTE_CONTENT}")
                
                # Create note and link to recipient contact (no alert)
                if create_linked_note "${CONTACT_ID}" "${NOTE_TITLE}" "${FORMATTED_CONTENT}"; then
                    MESSAGE_COUNT=$((MESSAGE_COUNT + 1))
                    echo "Logged GMoney's connection request to ${RECIPIENT_NAME} (no alert sent)"
                else
                    echo "Failed to create note for GMoney's connection request to ${RECIPIENT_NAME}" >&2
                fi
            else
                echo "Could not extract recipient name from connection request. Skipping note creation." >&2
            fi
        # Check if sender is GMoney (regular messages)
        elif is_gmoney "${SENDER_NAME}"; then
            echo "--- GMoney's Message (no alert) ---"
            echo "Conversation ID: ${CONVERSATION_ID}"
            echo "From: ${SENDER_NAME} (GMoney)"
            echo "Message: ${MESSAGE_TEXT}"
            echo "Timestamp: ${HUMAN_READABLE_TIMESTAMP}"
            echo "-------------------"
            
            # Extract recipient name from message
            EXTRACTED_NAME=$(extract_recipient_name "${MESSAGE_TEXT}" "${SENDER_NAME}")
            if [ -n "$EXTRACTED_NAME" ] && [ "$EXTRACTED_NAME" != "" ]; then
                echo "Extracted recipient: ${EXTRACTED_NAME}"
                
                # Get full name for recipient
                RECIPIENT_NAME=$(get_full_recipient_name "${EXTRACTED_NAME}")
                echo "Full recipient name: ${RECIPIENT_NAME}"
                
                # Try to find LinkedIn profile for recipient
                RECIPIENT_LINKEDIN=$(find_linkedin_profile "${RECIPIENT_NAME}")
                
                # Create contact for recipient
                CONTACT_ID=$(find_or_create_contact "${RECIPIENT_NAME}" "${RECIPIENT_LINKEDIN}")
                if [ -z "$CONTACT_ID" ]; then
                    echo "Failed to find or create contact for recipient ${RECIPIENT_NAME}. Skipping note creation." >&2
                    continue
                fi
                
                NOTE_TITLE="LinkedIn Message to ${RECIPIENT_NAME}"
                NOTE_CONTENT="${MESSAGE_TEXT}\\n\\n**From:** ${SENDER_NAME}\\n**Date:** ${HUMAN_READABLE_TIMESTAMP}\\n**Conversation ID:** ${CONVERSATION_ID}\\n\\n**LinkedIn Profile:** ${SENDER_PROFILE_URL}"
                
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

            # Find or create contact for sender (with LinkedIn-aware duplicate detection)
            CONTACT_ID=$(find_contact_by_linkedin_url "${SENDER_PROFILE_URL}" "${SENDER_NAME}")
            if [ -z "$CONTACT_ID" ]; then
                # No existing contact found, create new one
                CONTACT_ID=$(find_or_create_contact "${SENDER_NAME}" "${SENDER_PROFILE_URL}")
                if [ -z "$CONTACT_ID" ]; then
                    echo "Failed to find or create contact for ${SENDER_NAME}. Skipping note creation." >&2
                    continue
                fi
            else
                echo "Found existing contact for ${SENDER_NAME} by LinkedIn profile (ID: ${CONTACT_ID})"
            fi

            NOTE_TITLE="LinkedIn Message from ${SENDER_NAME}"
            NOTE_CONTENT="${MESSAGE_TEXT}\\n\\n**From:** ${SENDER_NAME}\\n**Date:** ${HUMAN_READABLE_TIMESTAMP}\\n**Conversation ID:** ${CONVERSATION_ID}\\n\\n**LinkedIn Profile:** ${SENDER_PROFILE_URL}"
            
            # Convert line breaks for proper markdown formatting
            FORMATTED_CONTENT=$(convert_line_breaks "${NOTE_CONTENT}")

            # Create note and link to contact with alert
            if create_linked_note "${CONTACT_ID}" "${NOTE_TITLE}" "${FORMATTED_CONTENT}"; then
                MESSAGE_COUNT=$((MESSAGE_COUNT + 1))
                # Convert timestamp to Pacific Time
                PT_TIMESTAMP=$(TZ="America/Los_Angeles" date -d "@$TIMESTAMP_SEC" "+%Y-%m-%d %I:%M %p PT")
                # Include more message content (500 chars) and PT time in alert
                send_alert "🔔 ${PT_TIMESTAMP} - ${SENDER_NAME}: ${MESSAGE_TEXT:0:500}... [${SENDER_PROFILE_URL}]"
            else
                echo "Failed to create note for message from ${SENDER_NAME}" >&2
            fi
        fi
    done
    
    if [ $MESSAGE_COUNT -gt 0 ]; then
        send_alert "Processed ${MESSAGE_COUNT} new LinkedIn messages and added them to Twenty CRM"
    fi

    # Update cursor state to the oldest processed message (for next batch)
    if [ -n "$NEW_CURSOR" ]; then
        echo "{\"last_cursor\": \"$NEW_CURSOR\"}" > "$STATE_FILE"
        echo "Updated cursor to oldest processed message: $NEW_CURSOR"
    else
        echo "No new cursor returned"
    fi

fi

exit 0
