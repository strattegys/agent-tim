#!/bin/bash
# Twenty CRM Integration Tool - Enhanced with Work Items Support

API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzczMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
BASE_URL="http://localhost:3000"

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

# Helper function to create and link note
create_linked_note() {
    local target_id="$1"
    local target_type="$2"  # person, company, opportunity, task, workItem
    local note_title="$3"
    local note_body="$4"
    
    # Check if content is too large
    if [ ${#note_body} -gt 4000 ]; then
        echo "📝 Content is large (${#note_body} chars), using chunked approach..."
        return create_large_linked_note "$target_id" "$target_type" "$note_title" "$note_body"
    fi
    
    # Create note
    local note_payload="{\"title\":\"${note_title}\",\"bodyV2\":{\"markdown\":\"${note_body}\"}}"
    local note_response=$(api_call POST "/rest/notes" "$note_payload")
    local note_id=$(echo "$note_response" | jq -r '.data.createNote.id // empty')
    
    if [ -n "$note_id" ] && [ "$note_id" != "null" ]; then
        # Determine target field name
        local target_field="target${target_type^}Id"
        
        # Link note to target
        local link_payload="{\"noteId\":\"${note_id}\",\"${target_field}\":\"${target_id}\"}"
        local link_response=$(api_call POST "/rest/noteTargets" "$link_payload")
        
        if echo "$link_response" | jq -e '.data.createNoteTarget.id' >/dev/null 2>&1; then
            echo "✅ Note created and linked successfully to $target_type"
            return 0
        else
            echo "❌ Note created but failed to link to $target_type"
            echo "Response: $link_response"
            return 1
        fi
    else
        echo "❌ Failed to create note"
        echo "Response: $note_response"
        return 1
    fi
}

# Helper function to create large chunked notes
create_large_linked_note() {
    local target_id="$1"
    local target_type="$2"
    local note_title="$3"
    local content="$4"
    
    local MAX_LENGTH=3500  # Conservative limit
    local OVERLAP=100
    
    echo "📊 Splitting ${#content} character content into chunks..."
    
    # Split content into chunks
    local chunks=()
    local content_length=${#content}
    local start=0
    local chunk_num=1
    
    while [ "$start" -lt "$content_length" ]; do
        local end=$((start + MAX_LENGTH))
        
        if [ "$end" -gt "$content_length" ]; then
            end=$content_length
        fi
        
        local chunk="${content:$start:$((end - start))}"
        
        # Try to break at word boundary if not the last chunk
        if [ "$end" -lt "$content_length" ]; then
            local last_space=${chunk##* }
            if [ ${#last_space} -gt 0 ] && [ ${#last_space} -lt $((MAX_LENGTH / 2)) ]; then
                chunk="${chunk% *}"
                end=$((start + ${#chunk}))
            fi
        fi
        
        chunks+=("$chunk")
        
        # Move to next chunk with overlap
        start=$((end - OVERLAP))
        if [ "$start" -lt 0 ]; then
            start=0
        fi
        
        chunk_num=$((chunk_num + 1))
    done
    
    echo "📋 Creating ${#chunks[@]} note chunks..."
    
    local note_ids=()
    chunk_num=1
    
    for chunk in "${chunks[@]}"; do
        local chunk_title="$note_title (Part $chunk_num/${#chunks[@]})"
        
        echo "📝 Creating chunk $chunk_num/${#chunks[@]} (${#chunk} chars)..."
        
        # Create note
        local escaped_chunk=$(echo "$chunk" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
        local note_payload="{\"title\":\"${chunk_title}\",\"bodyV2\":{\"markdown\":\"${escaped_chunk}\"}}"
        local note_response=$(api_call POST "/rest/notes" "$note_payload")
        local note_id=$(echo "$note_response" | jq -r '.data.createNote.id // empty')
        
        if [ -n "$note_id" ] && [ "$note_id" != "null" ]; then
            note_ids+=("$note_id")
            echo "✅ Chunk $chunk_num created: $note_id"
            
            # Link to target
            local target_field="target${target_type^}Id"
            local link_payload="{\"noteId\":\"${note_id}\",\"${target_field}\":\"${target_id}\"}"
            local link_response=$(api_call POST "/rest/noteTargets" "$link_payload")
            
            if ! echo "$link_response" | jq -e '.data.createNoteTarget.id' >/dev/null 2>&1; then
                echo "⚠️ Chunk created but failed to link"
            fi
        else
            echo "❌ Failed to create chunk $chunk_num"
            echo "Response: $note_response"
            return 1
        fi
        
        chunk_num=$((chunk_num + 1))
        sleep 0.5  # Small delay to avoid overwhelming API
    done
    
    echo "🎉 Large note created successfully!"
    echo "📋 Created ${#note_ids[@]} linked chunks"
    return 0
}

case "$1" in
    # PEOPLE/CONTACTS
    list-contacts)
        api_call GET "/rest/people"
        ;;
    search-contacts)
        QUERY="${2:-}"
        api_call GET "/rest/people?filter[name][ilike]=%${QUERY}%"
        ;;
    get-contact)
        api_call GET "/rest/people/$2"
        ;;
    create-contact)
        api_call POST "/rest/people" "$2"
        ;;
    update-contact)
        api_call PATCH "/rest/people/$2" "$3"
        ;;
    delete-contact)
        api_call DELETE "/rest/people/$2"
        ;;

    # COMPANIES
    list-companies)
        api_call GET "/rest/companies"
        ;;
    search-companies)
        QUERY="${2:-}"
        api_call GET "/rest/companies?filter[name][ilike]=%${QUERY}%"
        ;;
    get-company)
        api_call GET "/rest/companies/$2"
        ;;
    create-company)
        api_call POST "/rest/companies" "$2"
        ;;
    update-company)
        api_call PATCH "/rest/companies/$2" "$3"
        ;;
    delete-company)
        api_call DELETE "/rest/companies/$2"
        ;;

    # OPPORTUNITIES/DEALS
    list-opportunities)
        api_call GET "/rest/opportunities"
        ;;
    search-opportunities)
        QUERY="${2:-}"
        api_call GET "/rest/opportunities?filter[name][ilike]=%${QUERY}%"
        ;;
    get-opportunity)
        api_call GET "/rest/opportunities/$2"
        ;;
    create-opportunity)
        api_call POST "/rest/opportunities" "$2"
        ;;
    update-opportunity)
        api_call PATCH "/rest/opportunities/$2" "$3"
        ;;
    delete-opportunity)
        api_call DELETE "/rest/opportunities/$2"
        ;;

    # TASKS
    list-tasks)
        api_call GET "/rest/tasks"
        ;;
    search-tasks)
        QUERY="${2:-}"
        api_call GET "/rest/tasks?filter[title][ilike]=%${QUERY}%"
        ;;
    get-task)
        api_call GET "/rest/tasks/$2"
        ;;
    create-task)
        echo "DEBUG: twenty_crm.sh received payload for create-task: $2" >&2
        api_call POST "/rest/tasks" "$2"
        ;;
    create-task-target)
        api_call POST "/rest/taskTargets" "$2"
        ;;
    update-task)
        api_call PATCH "/rest/tasks/$2" "$3"
        ;;
    delete-task)
        api_call DELETE "/rest/tasks/$2"
        ;;

    # WORK ITEMS (NEW)
    list-work-items)
        api_call GET "/rest/workItems"
        ;;
    search-work-items)
        QUERY="${2:-}"
        api_call GET "/rest/workItems?filter[title][ilike]=%${QUERY}%"
        ;;
    get-work-item)
        api_call GET "/rest/workItems/$2"
        ;;
    create-work-item)
        echo "DEBUG: twenty_crm.sh received payload for create-work-item: $2" >&2
        api_call POST "/rest/workItems" "$2"
        ;;
    create-work-item-target)
        api_call POST "/rest/workItemTargets" "$2"
        ;;
    update-work-item)
        api_call PATCH "/rest/workItems/$2" "$3"
        ;;
    delete-work-item)
        api_call DELETE "/rest/workItems/$2"
        ;;
    # Enhanced note linking
    create-linked-note)
        TARGET_ID="$2"
        TARGET_TYPE="$3"  # person, company, opportunity, task, workItem
        NOTE_TITLE="$4"
        NOTE_BODY="$5"
        create_linked_note "$TARGET_ID" "$TARGET_TYPE" "$NOTE_TITLE" "$NOTE_BODY"
        ;;

    # NOTES
    list-notes)
        api_call GET "/rest/notes"
        ;;
    get-note)
        api_call GET "/rest/notes/$2"
        ;;
    create-note)
        echo "DEBUG: twenty_crm.sh received payload for create-note: $2" >&2
        api_call POST "/rest/notes" "$2"
        ;;
    create-note-target)
        api_call POST "/rest/noteTargets" "$2"
        ;;
    # ENHANCED: Create and link note in one command
    create-linked-note)
        TARGET_ID="$2"
        TARGET_TYPE="$3"
        NOTE_TITLE="$4"
        NOTE_BODY="$5"
        create_linked_note "$TARGET_ID" "$TARGET_TYPE" "$NOTE_TITLE" "$NOTE_BODY"
        ;;
    update-note)
        api_call PATCH "/rest/notes/$2" "$3"
        ;;
    delete-note)
        api_call DELETE "/rest/notes/$2"
        ;;

    # ACTIVITIES/TIMELINE
    list-activities)
        api_call GET "/rest/timelineActivities"
        ;;
    get-activity)
        api_call GET "/rest/timelineActivities/$2"
        ;;
    create-activity)
        api_call POST "/rest/timelineActivities" "$2"
        ;;

    # MESSAGES
    list-messages)
        api_call GET "/rest/messages"
        ;;
    get-message)
        api_call GET "/rest/messages/$2"
        ;;
    create-message)
        api_call POST "/rest/messages" "$2"
        ;;

    # MESSAGE THREADS
    list-message-threads)
        api_call GET "/rest/messageThreads"
        ;;
    get-message-thread)
        api_call GET "/rest/messageThreads/$2"
        ;;

    # CALENDAR EVENTS
    list-calendar-events)
        api_call GET "/rest/calendarEvents"
        ;;
    get-calendar-event)
        api_call GET "/rest/calendarEvents/$2"
        ;;
    create-calendar-event)
        api_call POST "/rest/calendarEvents" "$2"
        ;;
    update-calendar-event)
        api_call PATCH "/rest/calendarEvents/$2" "$3"
        ;;
    delete-calendar-event)
        api_call DELETE "/rest/calendarEvents/$2"
        ;;

    # ENHANCED FILE UPLOADS
    upload-file)
        FILE_PATH="$2"
        FILE_NAME="$3"
        DESCRIPTION="$4"
        
        if [ -z "$FILE_PATH" ]; then
            echo "❌ File path required"
            echo "Usage: upload-file <file_path> [file_name] [description]"
            exit 1
        fi
        
        if [ ! -f "$FILE_PATH" ]; then
            echo "❌ File not found: $FILE_PATH"
            exit 1
        fi
        
        # Use provided filename or extract from path
        if [ -z "$FILE_NAME" ]; then
            FILE_NAME=$(basename "$FILE_PATH")
        fi
        
        # Get file details
        FILE_SIZE=$(stat -c%s "$FILE_PATH" 2>/dev/null || stat -f%z "$FILE_PATH" 2>/dev/null)
        EXTENSION="${FILE_PATH##*.}"
        EXTENSION=$(echo "$EXTENSION" | tr '[:upper:]' '[:lower:]')
        
        # Determine MIME type
        case "$EXTENSION" in
            pdf) MIME_TYPE="application/pdf" ;;
            doc) MIME_TYPE="application/msword" ;;
            docx) MIME_TYPE="application/vnd.openxmlformats-officedocument.wordprocessingml.document" ;;
            xls) MIME_TYPE="application/vnd.ms-excel" ;;
            xlsx) MIME_TYPE="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ;;
            ppt) MIME_TYPE="application/vnd.ms-powerpoint" ;;
            pptx) MIME_TYPE="application/vnd.openxmlformats-officedocument.presentationml.presentation" ;;
            txt) MIME_TYPE="text/plain" ;;
            csv) MIME_TYPE="text/csv" ;;
            json) MIME_TYPE="application/json" ;;
            xml) MIME_TYPE="application/xml" ;;
            png) MIME_TYPE="image/png" ;;
            jpg|jpeg) MIME_TYPE="image/jpeg" ;;
            gif) MIME_TYPE="image/gif" ;;
            svg) MIME_TYPE="image/svg+xml" ;;
            mp4) MIME_TYPE="video/mp4" ;;
            mp3) MIME_TYPE="audio/mpeg" ;;
            zip) MIME_TYPE="application/zip" ;;
            *) MIME_TYPE="application/octet-stream" ;;
        esac
        
        echo "📤 Uploading file: $FILE_NAME"
        echo "📊 Size: $FILE_SIZE bytes"
        echo "📄 Type: $MIME_TYPE"
        
        # Create metadata
        METADATA_FILE="/tmp/twenty_upload_$$.json"
        cat > "$METADATA_FILE" << EOF
{
  "name": "$FILE_NAME",
  "description": "${DESCRIPTION:-"Uploaded via Twenty CRM API"}",
  "mimeType": "$MIME_TYPE",
  "size": $FILE_SIZE
}
EOF
        
        # Upload file
        RESPONSE=$(curl -s -X POST \
          -H "Authorization: Bearer ${API_KEY}" \
          -F "metadata=@$METADATA_FILE" \
          -F "file=@$FILE_PATH" \
          "${BASE_URL}/rest/attachments")
        
        # Clean up
        rm -f "$METADATA_FILE"
        
        # Check response
        if echo "$RESPONSE" | jq -e '.data.createAttachment.id' >/dev/null 2>&1; then
            ATTACHMENT_ID=$(echo "$RESPONSE" | jq -r '.data.createAttachment.id')
            echo "✅ File uploaded successfully!"
            echo "📋 Attachment ID: $ATTACHMENT_ID"
            echo "$RESPONSE" | jq '.data.createAttachment'
        else
            echo "❌ Upload failed:"
            echo "$RESPONSE" | jq -r '.error // .message // "Unknown error"'
            exit 1
        fi
        ;;
        
    upload-and-link)
        FILE_PATH="$2"
        OBJECT_TYPE="$3"
        OBJECT_ID="$4"
        FILE_NAME="$5"
        DESCRIPTION="$6"
        
        if [ -z "$FILE_PATH" ] || [ -z "$OBJECT_TYPE" ] || [ -z "$OBJECT_ID" ]; then
            echo "❌ File path, object type, and object ID required"
            echo "Usage: upload-and-link <file_path> <object_type> <object_id> [file_name] [description]"
            echo "Object types: person, company, opportunity, task, workItem"
            exit 1
        fi
        
        echo "🚀 Uploading and linking file..."
        
        # Upload file first
        UPLOAD_RESULT=$("$0" upload-file "$FILE_PATH" "$FILE_NAME" "$DESCRIPTION" 2>&1)
        if ! echo "$UPLOAD_RESULT" | grep -q "✅ File uploaded successfully"; then
            echo "❌ Upload failed: $UPLOAD_RESULT"
            exit 1
        fi
        
        # Extract attachment ID
        ATTACHMENT_ID=$(echo "$UPLOAD_RESULT" | grep "Attachment ID:" | cut -d' ' -f3)
        
        if [ -z "$ATTACHMENT_ID" ]; then
            echo "❌ Could not extract attachment ID"
            exit 1
        fi
        
        # Determine target field
        case "$OBJECT_TYPE" in
            person|people) TARGET_FIELD="targetPersonId" ;;
            company|companies) TARGET_FIELD="targetCompanyId" ;;
            opportunity|opportunities) TARGET_FIELD="targetOpportunityId" ;;
            task|tasks) TARGET_FIELD="targetTaskId" ;;
            workItem|workItems) TARGET_FIELD="targetWorkItemId" ;;
            *)
                echo "❌ Unsupported object type: $OBJECT_TYPE"
                echo "Supported: person, company, opportunity, task, workItem"
                exit 1
                ;;
        esac
        
        # Link attachment
        LINK_PAYLOAD="{\"attachmentId\":\"$ATTACHMENT_ID\",\"$TARGET_FIELD\":\"$OBJECT_ID\"}"
        LINK_RESPONSE=$(api_call POST "/rest/attachmentTargets" "$LINK_PAYLOAD")
        
        if echo "$LINK_RESPONSE" | jq -e '.data.createAttachmentTarget.id' >/dev/null 2>&1; then
            echo "✅ File uploaded and linked successfully!"
            echo "🔗 Attachment ID: $ATTACHMENT_ID linked to $OBJECT_TYPE"
        else
            echo "❌ Linking failed:"
            echo "$LINK_RESPONSE"
            exit 1
        fi
        ;;
        
    download-attachment)
        ATTACHMENT_ID="$2"
        OUTPUT_PATH="$3"
        
        if [ -z "$ATTACHMENT_ID" ]; then
            echo "❌ Attachment ID required"
            echo "Usage: download-attachment <attachment_id> [output_path]"
            exit 1
        fi
        
        # Get attachment details
        DETAILS=$(api_call GET "/rest/attachments/$ATTACHMENT_ID")
        
        if ! echo "$DETAILS" | jq -e '.data' >/dev/null 2>&1; then
            echo "❌ Attachment not found: $ATTACHMENT_ID"
            exit 1
        fi
        
        FILE_NAME=$(echo "$DETAILS" | jq -r '.data.name // "download"')
        
        if [ -z "$OUTPUT_PATH" ]; then
            OUTPUT_PATH="$FILE_NAME"
        fi
        
        echo "📥 Downloading: $FILE_NAME to $OUTPUT_PATH"
        
        # Download file
        curl -s -X GET \
          -H "Authorization: Bearer ${API_KEY}" \
          -o "$OUTPUT_PATH" \
          "${BASE_URL}/rest/attachments/$ATTACHMENT_ID/download"
        
        if [ $? -eq 0 ]; then
            echo "✅ Downloaded successfully: $OUTPUT_PATH"
        else
            echo "❌ Download failed"
            exit 1
        fi
        ;;
        
    list-attachments)
        api_call GET "/rest/attachments" | jq '.data.attachments[] | "📄 \(.name // "Unnamed") (\(.mimeType // "unknown")) - \(.size // 0) bytes - ID: \(.id)"'
        ;;
        
    get-attachment)
        api_call GET "/rest/attachments/$2"
        ;;
        
    delete-attachment)
        api_call DELETE "/rest/attachments/$2"
        ;;

    # FAVORITES
    list-favorites)
        api_call GET "/rest/favorites"
        ;;
    create-favorite)
        api_call POST "/rest/favorites" "$2"
        ;;
    delete-favorite)
        api_call DELETE "/rest/favorites/$2"
        ;;

    # WORKFLOWS
    list-workflows)
        api_call GET "/rest/workflows"
        ;;
    get-workflow)
        api_call GET "/rest/workflows/$2"
        ;;
    create-workflow)
        api_call POST "/rest/workflows" "$2"
        ;;
    update-workflow)
        api_call PATCH "/rest/workflows/$2" "$3"
        ;;
    delete-workflow)
        api_call DELETE "/rest/workflows/$2"
        ;;

    # CONNECTED ACCOUNTS
    list-connected-accounts)
        api_call GET "/rest/connectedAccounts"
        ;;
    get-connected-account)
        api_call GET "/rest/connectedAccounts/$2"
        ;;

    # WORKSPACE MEMBERS
    list-workspace-members)
        api_call GET "/rest/workspaceMembers"
        ;;
    get-workspace-member)
        api_call GET "/rest/workspaceMembers/$2"
        ;;
        
    create-large-note)
        TITLE="$2"
        CONTENT="$3"
        OBJECT_TYPE="$4"
        OBJECT_ID="$5"
        
        if [ -z "$TITLE" ] || [ -z "$CONTENT" ]; then
            echo "❌ Title and content required"
            echo "Usage: create-large-note <title> <content> [object_type] [object_id]"
            exit 1
        fi
        
        if [ -n "$OBJECT_TYPE" ] && [ -n "$OBJECT_ID" ]; then
            create_linked_note "$OBJECT_ID" "$OBJECT_TYPE" "$TITLE" "$CONTENT"
        else
            # Create standalone large note
            if [ ${#CONTENT} -gt 4000 ]; then
                echo "📝 Content is large, creating chunked notes..."
                # Use the large note logic without linking
                MAX_LENGTH=3500
                OVERLAP=100
                
                chunks=()
                content_length=${#CONTENT}
                start=0
                chunk_num=1
                
                while [ "$start" -lt "$content_length" ]; do
                    end=$((start + MAX_LENGTH))
                    if [ "$end" -gt "$content_length" ]; then
                        end=$content_length
                    fi
                    
                    chunk="${CONTENT:$start:$((end - start))}"
                    
                    if [ "$end" -lt "$content_length" ]; then
                        last_space=${chunk##* }
                        if [ ${#last_space} -gt 0 ] && [ ${#last_space} -lt $((MAX_LENGTH / 2)) ]; then
                            chunk="${chunk% *}"
                            end=$((start + ${#chunk}))
                        fi
                    fi
                    
                    chunks+=("$chunk")
                    start=$((end - OVERLAP))
                    if [ "$start" -lt 0 ]; then
                        start=0
                    fi
                    chunk_num=$((chunk_num + 1))
                done
                
                echo "📋 Creating ${#chunks[@]} note chunks..."
                
                for i in "${!chunks[@]}"; do
                    chunk="${chunks[$i]}"
                    chunk_title="$TITLE (Part $((i+1))/${#chunks[@]})"
                    
                    escaped_chunk=$(echo "$chunk" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
                    note_payload="{\"title\":\"${chunk_title}\",\"bodyV2\":{\"markdown\":\"${escaped_chunk}\"}}"
                    note_response=$(api_call POST "/rest/notes" "$note_payload")
                    
                    if echo "$note_response" | jq -e '.data.createNote.id' >/dev/null 2>&1; then
                        note_id=$(echo "$note_response" | jq -r '.data.createNote.id')
                        echo "✅ Chunk $((i+1)) created: $note_id"
                    else
                        echo "❌ Failed to create chunk $((i+1))"
                    fi
                    
                    sleep 0.5
                done
                
                echo "🎉 Large note created with ${#chunks[@]} chunks!"
            else
                # Create regular note
                note_payload="{\"title\":\"$TITLE\",\"bodyV2\":{\"markdown\":\"$CONTENT\"}}"
                note_response=$(api_call POST "/rest/notes" "$note_payload")
                
                if echo "$note_response" | jq -e '.data.createNote.id' >/dev/null 2>&1; then
                    note_id=$(echo "$note_response" | jq -r '.data.createNote.id')
                    echo "✅ Note created: $note_id"
                else
                    echo "❌ Failed to create note"
                fi
            fi
        fi
        ;;
        
    create-note-from-file)
        FILE_PATH="$2"
        TITLE="$3"
        OBJECT_TYPE="$4"
        OBJECT_ID="$5"
        USE_SUMMARY="$6"
        
        if [ -z "$FILE_PATH" ]; then
            echo "❌ File path required"
            echo "Usage: create-note-from-file <file_path> [title] [object_type] [object_id] [use_summary]"
            exit 1
        fi
        
        if [ ! -f "$FILE_PATH" ]; then
            echo "❌ File not found: $FILE_PATH"
            exit 1
        fi
        
        if [ -z "$TITLE" ]; then
            TITLE="Document: $(basename "$FILE_PATH")"
        fi
        
        echo "📖 Reading file: $FILE_PATH"
        CONTENT=$(cat "$FILE_PATH")
        
        if [ -z "$CONTENT" ]; then
            echo "❌ File is empty"
            exit 1
        fi
        
        if [ "$USE_SUMMARY" = "true" ]; then
            # Convert file path to Google Drive URL
            GOOGLE_DRIVE_URL=""
            FILENAME=$(basename "$FILE_PATH")
            
            # Specific handling for BCA document
            if [[ "$FILENAME" == "BCA_and_Timbot_Launch_Plan.md" ]]; then
                GOOGLE_DRIVE_URL="https://docs.google.com/document/d/1BTNeUd6MFGS5ryADrwbFzv9mX5HVBfNre09YDkcSOik/edit?usp=drivesdk"
            elif [[ "$FILE_PATH" == *"/mnt/gdrive/"* ]]; then
                # Generic Google Drive URL (would need specific file ID)
                GOOGLE_DRIVE_URL="https://drive.google.com/file/d/FILE_ID/view?usp=drivesdk"
            fi
            
            # Create summary with clickable Google Drive URL
            if [ -n "$GOOGLE_DRIVE_URL" ]; then
                SUMMARY_CONTENT="$CONTENT

---

## 📁 Full Document

**🔗 [Click here to open in Google Drive]($GOOGLE_DRIVE_URL)**

### 📋 Document Information
- **File Name:** $(basename "$FILE_PATH")
- **Last Updated:** $(date)
- **Document Type:** Markdown
- **Location:** Google Drive

### 🔍 Access Instructions
1. **Click the link above** to open the document
2. **View the complete content** in Google Drive
3. **Edit directly** in Google Docs if needed
4. **Changes are automatically saved** and reflected here

---

### 📊 Content Summary
This note contains a preview of the document content for quick reference. The complete, up-to-date version is always available through the Google Drive link above.

**💡 Tip:** Bookmark the Google Drive link for quick access to the full document.

---

*This summary note provides quick access to key information within the CRM. The full document contains additional details, context, and supporting information available through the Google Drive link.*"
            else
                # Fallback to local path if URL conversion fails
                SUMMARY_CONTENT="$CONTENT

---

## 📁 Full Document
**File Location:** \`$FILE_PATH\`

**Access Instructions:**
1. Navigate to the file path above
2. Open the document for complete content
3. This note contains a summary for quick reference

**Document Type:** $(basename "$FILE_PATH")
**Last Updated:** $(date)

---

*This summary note provides quick access to key information. The full document contains additional details, context, and supporting information.*"
            fi
            
            if [ ${#SUMMARY_CONTENT} -gt 4000 ]; then
                # Create shorter summary
                SUMMARY_CONTENT="## 📋 Document Summary

**File:** \`$FILE_PATH\`
**Title:** $TITLE
**Updated:** $(date)

**Content Preview:**
${CONTENT:0:2000}...

---

**📁 Full Document Available At:**
\`$FILE_PATH\`

*The complete document contains extensive details, context, and supporting information. Please refer to the source file for full content.*"
            fi
            
            CONTENT="$SUMMARY_CONTENT"
        fi
        
        if [ -n "$OBJECT_TYPE" ] && [ -n "$OBJECT_ID" ]; then
            create_linked_note "$OBJECT_ID" "$OBJECT_TYPE" "$TITLE" "$CONTENT"
        else
            "$0" create-large-note "$TITLE" "$CONTENT"
        fi
        ;;
        
    # BCA DOCUMENT HANDLER
    create-bca-note)
        OBJECT_TYPE="$2"
        OBJECT_ID="$3"
        
        if [ -z "$OBJECT_TYPE" ] || [ -z "$OBJECT_ID" ]; then
            echo "❌ Object type and ID required"
            echo "Usage: create-bca-note <object_type> <object_id>"
            exit 1
        fi
        
        # BCA document specific details
        BCA_FILE="/mnt/gdrive/Tim_Files/General/BCA_and_Timbot_Launch_Plan.md"
        BCA_URL="https://docs.google.com/document/d/1BTNeUd6MFGS5ryADrwbFzv9mX5HVBfNre09YDkcSOik/edit?usp=drivesdk"
        
        if [ ! -f "$BCA_FILE" ]; then
            echo "❌ BCA document not found: $BCA_FILE"
            exit 1
        fi
        
        echo "📖 Reading BCA Launch Plan document..."
        CONTENT=$(cat "$BCA_FILE")
        
        # Create BCA-specific summary
        BCA_SUMMARY="$CONTENT

---

## 🚀 BCA & TimBot Launch Plan

### 📄 Complete Document
**🔗 [📖 Open BCA Launch Plan in Google Drive]($BCA_URL)**

### 📋 Document Information
- **Document:** BCA and TimBot Launch Plan
- **Last Updated:** $(date)
- **Format:** Google Docs (Markdown compatible)
- **Access:** Click link above for full document

### 🔍 Quick Access Options
1. **🔗 Click the Google Drive link** above for the complete plan
2. **📱 Access from any device** with Google Drive
3. **✏️ Edit directly** in Google Docs
4. **🔄 Changes sync** automatically

---

### 💡 Important Notes
- **Full content available** through the Google Drive link
- **Live updates** reflected immediately
- **Collaborative editing** enabled in Google Docs
- **Version history** maintained in Google Drive

---

*This CRM note provides a preview and quick access. The complete, up-to-date BCA Launch Plan is always available through the Google Drive link above.*"
        
        # Check size and adjust if needed
        if [ ${#BCA_SUMMARY} -gt 4000 ]; then
            BCA_SUMMARY="## 🚀 BCA & TimBot Launch Plan

### 📄 Document Access
**🔗 [📖 Open Complete BCA Launch Plan]($BCA_URL)**

### 📋 Quick Overview
**Document:** BCA and TimBot Launch Plan  
**Updated:** $(date)  
**Format:** Google Docs

### 📖 Content Preview
${CONTENT:0:1200}...

---

## 📁 Full Document Access

**🔗 [🚀 Click here to open the complete BCA Launch Plan]($BCA_URL)**

### 💡 Access Information
- **Complete plan available** through Google Drive link
- **Real-time updates** when edited in Google Docs
- **Mobile friendly** access from any device
- **Collaborative features** enabled

---

*The complete BCA Launch Plan contains detailed implementation strategies, timelines, and resource requirements. Access the full document through the Google Drive link above.*"
        fi
        
        echo "📝 Creating BCA Launch Plan note with Google Drive URL..."
        
        # Create the note
        escaped_content=$(echo "$BCA_SUMMARY" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
        note_payload="{\"title\":\"BCA and TimBot Launch Plan\",\"bodyV2\":{\"markdown\":\"$escaped_content\"}}"
        note_response=$(api_call POST "/rest/notes" "$note_payload")
        
        if echo "$note_response" | jq -e '.data.createNote.id' >/dev/null 2>&1; then
            note_id=$(echo "$note_response" | jq -r '.data.createNote.id')
            echo "✅ BCA Launch Plan note created: $note_id"
            
            # Link to object
            target_field="target${OBJECT_TYPE^}Id"
            link_payload="{\"noteId\":\"$note_id\",\"${target_field}\":\"$OBJECT_ID\"}"
            link_response=$(api_call POST "/rest/noteTargets" "$link_payload")
            
            if echo "$link_response" | jq -e '.data.createNoteTarget.id' >/dev/null 2>&1; then
                echo "✅ BCA note linked to $OBJECT_TYPE successfully"
            else
                echo "⚠️ BCA note created but failed to link to $OBJECT_TYPE"
            fi
            
            echo ""
            echo "🎉 BCA Launch Plan note created successfully!"
            echo "📋 Note ID: $note_id"
            echo "🔗 Google Drive: $BCA_URL"
            echo "📱 Click the link in CRM to open the document"
        else
            echo "❌ Failed to create BCA note"
            echo "Response: $note_response"
            exit 1
        fi
        ;;

    # HELP
    *)
        echo "Twenty CRM Tool - Enhanced with Work Items Support"
        echo ""
        echo "CONTACTS:"
        echo "  list-contacts, search-contacts <query>, get-contact <id>"
        echo "  create-contact <json>, update-contact <id> <json>, delete-contact <id>"
        echo ""
        echo "COMPANIES:"
        echo "  list-companies, search-companies <query>, get-company <id>"
        echo "  create-company <json>, update-company <id> <json>, delete-company <id>"
        echo ""
        echo "OPPORTUNITIES:"
        echo "  list-opportunities, search-opportunities <query>, get-opportunity <id>"
        echo "  create-opportunity <json>, update-opportunity <id> <json>, delete-opportunity <id>"
        echo ""
        echo "TASKS:"
        echo "  list-tasks, search-tasks <query>, get-task <id>"
        echo "  create-task <json>, update-task <id> <json>, delete-task <id>"
        echo ""
        echo "WORK ITEMS (NEW):"
        echo "  list-work-items, search-work-items <query>, get-work-item <id>"
        echo "  create-work-item <json>, update-work-item <id> <json>, delete-work-item <id>"
        echo ""
        echo "NOTES:"
        echo "  list-notes, get-note <id>, create-note <json>"
        echo "  create-note-target <json>, create-linked-note <target_id> <target_type> <title> <body>"
        echo "  update-note <id> <json>, delete-note <id>"
        echo ""
        echo "ENHANCED NOTE LINKING:"
        echo "  create-linked-note <target_id> <target_type> <title> <body>"
        echo "    # Examples:"
        echo "    create-linked-note <task-id> task 'Update' 'Progress note'"
        echo "    create-linked-note <contact-id> person 'Meeting' 'Discussion notes'"
        echo "    create-linked-note <custom-object-id> CustomObject 'Note' 'Content'"
        echo ""
        echo "LARGE NOTES (Handles content > 4000 chars):"
        echo "  create-large-note <title> <content> [object_type] [object_id]"
        echo "  create-note-from-file <file_path> [title] [object_type] [object_id] [use_summary]"
        echo "  create-bca-note <object_type> <object_id>"
        echo "    # Examples:"
        echo "    create-large-note 'Project Plan' '\$(cat plan.md)' workItem abc-123"
        echo "    create-note-from-file /path/to/doc.md 'Document' workItem abc-123"
        echo "    create-note-from-file /path/to/doc.md 'Document' workItem abc-123 true"
        echo "    create-bca-note workItem 15b55664-1806-4f14-97a4-e002797a5f38"
        echo ""
        echo "NOTES:"
        echo "  list-notes, get-note <id>, create-note <json>"
        echo "  create-note-target <json>, update-note <id> <json>, delete-note <id>"
        echo ""
        echo "ACTIVITIES:"
        echo "  list-activities, get-activity <id>, create-activity <json>"
        echo ""
        echo "MESSAGES:"
        echo "  list-messages, get-message <id>, create-message <json>"
        echo "  list-message-threads, get-message-thread <id>"
        echo ""
        echo "CALENDAR EVENTS:"
        echo "  list-calendar-events, get-calendar-event <id>"
        echo "  create-calendar-event <json>, update-calendar-event <id> <json>, delete-calendar-event <id>"
        echo ""
        echo "FILE UPLOADS:"
        echo "  upload-file <file_path> [file_name] [description]"
        echo "  upload-and-link <file_path> <object_type> <object_id> [file_name] [description]"
        echo "  download-attachment <attachment_id> [output_path]"
        echo "  list-attachments, get-attachment <id>, delete-attachment <id>"
        echo ""
        echo "SUPPORTED FILE TYPES:"
        echo "  Documents: pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv, json, xml"
        echo "  Images: png, jpg, jpeg, gif, svg"
        echo "  Media: mp4, mp3"
        echo "  Archives: zip, rar"
        echo ""
        echo "OBJECT TYPES FOR LINKING:"
        echo "  person, company, opportunity, task, workItem"
        echo ""
        echo "OTHER:"
        echo "  list-favorites, list-workflows, list-connected-accounts, list-workspace-members"
        exit 1
        ;;
esac
