#!/bin/bash

# Test adding a note to a task
TASK_ID="d3384c35-d9c6-4625-8888-32c6b0ddddcd"

echo "Testing note creation for task: $TASK_ID"

# Create note
NOTE_PAYLOAD='{"title":"Test Note for Task","bodyV2":{"markdown":"This is a test note added to a task"}}'
echo "Creating note with payload: $NOTE_PAYLOAD"

NOTE_RESPONSE=$(ssh root@137.184.187.233 "/root/.nanobot/tools/twenty_crm.sh create-note '$NOTE_PAYLOAD'")
echo "Note response: $NOTE_RESPONSE"

NOTE_ID=$(echo "$NOTE_RESPONSE" | jq -r '.data.createNote.id // empty')
echo "Extracted note ID: $NOTE_ID"

if [ -n "$NOTE_ID" ] && [ "$NOTE_ID" != "null" ]; then
    echo "Linking note to task..."
    # Link note to task
    LINK_PAYLOAD="{\"noteId\":\"$NOTE_ID\",\"targetTaskId\":\"$TASK_ID\"}"
    echo "Link payload: $LINK_PAYLOAD"
    
    LINK_RESPONSE=$(ssh root@137.184.187.233 "/root/.nanobot/tools/twenty_crm.sh create-note-target '$LINK_PAYLOAD'")
    echo "Link response: $LINK_RESPONSE"
    
    if echo "$LINK_RESPONSE" | jq -e '.data.createNoteTarget.id' >/dev/null 2>&1; then
        echo "✅ Successfully created and linked note to task!"
    else
        echo "❌ Failed to link note to task"
    fi
else
    echo "❌ Failed to create note"
fi
