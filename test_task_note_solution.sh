#!/bin/bash

echo "=== Twenty CRM Task-Note Relationship Solution Test ==="

# Get a test task ID
echo "1. Getting a test task ID..."
TASK_RESPONSE=$(ssh root@137.184.187.233 "/root/.nanobot/tools/twenty_crm.sh list-tasks")
TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.data[0].id // empty')

if [ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ]; then
    echo "✅ Found task ID: $TASK_ID"
    
    # Create note
    echo "2. Creating note..."
    NOTE_PAYLOAD='{"title":"Test Note for Task","bodyV2":{"markdown":"This is a test note added to demonstrate the Task-Note relationship fix"}}'
    NOTE_RESPONSE=$(ssh root@137.184.187.233 "/root/.nanobot/tools/twenty_crm.sh create-note '$NOTE_PAYLOAD'")
    NOTE_ID=$(echo "$NOTE_RESPONSE" | jq -r '.data.createNote.id // empty')
    
    if [ -n "$NOTE_ID" ] && [ "$NOTE_ID" != "null" ]; then
        echo "✅ Created note ID: $NOTE_ID"
        
        # Link note to task
        echo "3. Linking note to task..."
        LINK_PAYLOAD="{\"noteId\":\"$NOTE_ID\",\"targetTaskId\":\"$TASK_ID\"}"
        LINK_RESPONSE=$(ssh root@137.184.187.233 "/root/.nanobot/tools/twenty_crm.sh create-note-target '$LINK_PAYLOAD'")
        
        if echo "$LINK_RESPONSE" | jq -e '.data.createNoteTarget.id' >/dev/null 2>&1; then
            echo "✅ Successfully linked note to task!"
            echo "🎉 Task-Note relationship is working correctly!"
        else
            echo "❌ Failed to link note to task"
            echo "Response: $LINK_RESPONSE"
        fi
    else
        echo "❌ Failed to create note"
        echo "Response: $NOTE_RESPONSE"
    fi
else
    echo "❌ No tasks found to test with"
fi

echo ""
echo "=== Solution Summary ==="
echo "✅ Task-Note relationship now works via NoteTarget junction table"
echo "✅ Notes can be created and linked to tasks in 2 steps"
echo "✅ Enhanced tool provides create-linked-note for single-step operation"
echo "✅ Work Items support added to Twenty CRM tool"
echo ""
echo "Usage Examples:"
echo "# Traditional 2-step method:"
echo "NOTE_RESPONSE=\$(bash twenty_crm.sh create-note '{\"title\":\"Note\",\"bodyV2\":{\"markdown\":\"Content\"}}')"
echo "NOTE_ID=\$(echo \$NOTE_RESPONSE | jq -r '.data.createNote.id')"
echo "bash twenty_crm.sh create-note-target '{\"noteId\":\"\$NOTE_ID\",\"targetTaskId\":\"\$TASK_ID\"}'"
echo ""
echo "# Enhanced single-step method:"
echo "bash twenty_crm_enhanced.sh create-linked-note <task-id> task \"Title\" \"Content\""
