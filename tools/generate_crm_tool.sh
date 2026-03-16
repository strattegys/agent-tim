#!/bin/bash
# Dynamic CRM Tool Generator from Schema

SCHEMA_FILE="$1"
TOOLS_DIR="/root/.nanobot/tools"
OUTPUT_FILE="$TOOLS_DIR/twenty_crm_dynamic.sh"

if [ ! -f "$SCHEMA_FILE" ]; then
    echo "❌ Schema file not found: $SCHEMA_FILE"
    exit 1
fi

echo "🛠️ Generating dynamic CRM tool from schema..."

# Start with base template
cat > "$OUTPUT_FILE" << 'EOF'
#!/bin/bash
# Twenty CRM Integration Tool - Auto-Generated from Schema
# Generated: $(date)
# Schema Version: $(jq -r '.version' "$SCHEMA_FILE" 2>/dev/null || echo "unknown")

API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzMzMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
BASE_URL="http://localhost:3000"
SCHEMA_CACHE="/root/.nanobot/twenty_schema.json"

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

# Validate payload against schema
validate_payload() {
    local object_type="$1"
    local payload="$2"
    
    # Check if object exists in schema
    if ! jq -e --arg object "$object_type" '.objects[$object]' "$SCHEMA_CACHE" >/dev/null 2>&1; then
        echo "❌ Unknown object type: $object_type"
        echo "💡 Available objects:"
        jq -r '.objects | keys | .[]' "$SCHEMA_CACHE" | sed 's/^/  - /'
        return 1
    fi
    
    # Basic validation - could be enhanced
    echo "$payload" | jq . >/dev/null 2>&1
    if [ $? -ne 0 ]; then
        echo "❌ Invalid JSON payload"
        return 1
    fi
    
    return 0
}

# Helper function to create and link note
create_linked_note() {
    local target_id="$1"
    local target_type="$2"  # person, company, opportunity, task, workItem, or custom object
    local note_title="$3"
    local note_body="$4"
    
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

EOF

# Add standard objects first
cat >> "$OUTPUT_FILE" << 'EOF'
case "$1" in
EOF

# Generate handlers for each discovered object
jq -r '.objects | keys | .[]' "$SCHEMA_FILE" | while read object; do
    # Convert object name to lowercase and plural for endpoints
    object_lower=$(echo "$object" | tr '[:upper:]' '[:lower:]')
    if [[ "$object_lower" == *"person"* ]]; then
        object_plural="people"
    elif [[ "$object_lower" == *"company"* ]]; then
        object_plural="companies"
    else
        object_plural="${object_lower}s"
    fi
    
    echo "    # $object handlers"
    echo "    list-$object_plural)"
    echo "        api_call GET \"/rest/$object_plural\""
    echo "        ;;"
    echo "    search-$object_plural)"
    echo "        QUERY=\"\${2:-}\""
    echo "        api_call GET \"/rest/$object_plural?filter[name][ilike]=%\${QUERY}%\""
    echo "        ;;"
    echo "    get-$object_lower)"
    echo "        api_call GET \"/rest/$object_plural/\$2\""
    echo "        ;;"
    echo "    create-$object_lower)"
    echo "        if validate_payload \"$object\" \"\$2\"; then"
    echo "            echo \"DEBUG: Creating $object: \$2\" >&2"
    echo "            api_call POST \"/rest/$object_plural\" \"\$2\""
    echo "        fi"
    echo "        ;;"
    echo "    update-$object_lower)"
    echo "        api_call PATCH \"/rest/$object_plural/\$2\" \"\$3\""
    echo "        ;;"
    echo "    delete-$object_lower)"
    echo "        api_call DELETE \"/rest/$object_plural/\$2\""
    echo "        ;;"
    echo ""
done

# Add enhanced note linking
cat >> "$OUTPUT_FILE" << 'EOF'
    # Enhanced note linking for all objects
    create-linked-note)
        TARGET_ID="$2"
        TARGET_TYPE="$3"
        NOTE_TITLE="$4"
        NOTE_BODY="$5"
        create_linked_note "$TARGET_ID" "$TARGET_TYPE" "$NOTE_TITLE" "$NOTE_BODY"
        ;;

EOF

# Add standard commands
cat >> "$OUTPUT_FILE" << 'EOF'
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
    update-note)
        api_call PATCH "/rest/notes/$2" "$3"
        ;;
    delete-note)
        api_call DELETE "/rest/notes/$2"
        ;;

    # HELP
    *)
        echo "Twenty CRM Tool - Auto-Generated from Schema"
        echo ""
        echo "DISCOVERED OBJECTS:"
EOF

# Add help for each discovered object
jq -r '.objects | keys | .[]' "$SCHEMA_FILE" | while read object; do
    object_lower=$(echo "$object" | tr '[:upper:]' '[:lower:]')
    if [[ "$object_lower" == *"person"* ]]; then
        object_plural="people"
    elif [[ "$object_lower" == *"company"* ]]; then
        object_plural="companies"
    else
        object_plural="${object_lower}s"
    fi
    
    echo "        echo \"  $object (NEW):\"" >> "$OUTPUT_FILE"
    echo "        echo \"    list-$object_plural, search-$object_plural <query>, get-$object_lower <id>\"" >> "$OUTPUT_FILE"
    echo "        echo \"    create-$object_lower <json>, update-$object_lower <id> <json>, delete-$object_lower <id>\"" >> "$OUTPUT_FILE"
    echo "        echo \"\"" >> "$OUTPUT_FILE"
done

# Add standard help sections
cat >> "$OUTPUT_FILE" << 'EOF'
        echo "ENHANCED NOTE LINKING:"
        echo "  create-linked-note <target_id> <target_type> <title> <body>"
        echo "    # Examples:"
        echo "    create-linked-note <task-id> task 'Update' 'Progress note'"
        echo "    create-linked-note <contact-id> person 'Meeting' 'Discussion notes'"
        echo "    create-linked-note <custom-object-id> CustomObject 'Note' 'Content'"
        echo ""
        echo "NOTES:"
        echo "  list-notes, get-note <id>, create-note <json>"
        echo "  create-note-target <json>, update-note <id> <json>, delete-note <id>"
        echo ""
        echo "DISCOVERED AT: $(jq -r '.discovered_at' "$SCHEMA_FILE" 2>/dev/null || echo "unknown")"
        echo "SCHEMA VERSION: $(jq -r '.version' "$SCHEMA_FILE" 2>/dev/null || echo "unknown")"
        exit 1
        ;;
esac
EOF

chmod +x "$OUTPUT_FILE"

echo "✅ Dynamic CRM tool generated: $OUTPUT_FILE"
echo "📋 Generated handlers for $(jq -r '.objects | keys | length' "$SCHEMA_FILE") objects"

# Show sample of generated commands
echo ""
echo "🎯 Sample commands for discovered objects:"
jq -r '.objects | keys | .[]' "$SCHEMA_FILE" | head -3 | while read object; do
    object_lower=$(echo "$object" | tr '[:upper:]' '[:lower:]')
    if [[ "$object_lower" == *"person"* ]]; then
        object_plural="people"
    elif [[ "$object_lower" == *"company"* ]]; then
        object_plural="companies"
    else
        object_plural="${object_lower}s"
    fi
    echo "  # $object operations:"
    echo "  /root/.nanobot/tools/twenty_crm_dynamic.sh list-$object_plural"
    echo "  /root/.nanobot/tools/twenty_crm_dynamic.sh create-$object_lower '{\"title\":\"Test\"}'"
    echo "  /root/.nanobot/tools/twenty_crm_dynamic.sh create-linked-note <id> $object_lower 'Note' 'Content'"
    echo ""
done
