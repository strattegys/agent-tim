#!/bin/bash
# Twenty CRM Large Notes Handler

API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzMzMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
BASE_URL="http://localhost:3000"

# Configuration
MAX_NOTE_LENGTH=5000  # Conservative limit for Twenty CRM
CHUNK_OVERLAP=200     # Overlap between chunks for context

# Helper function to create note with error handling
create_note_safe() {
    local title="$1"
    local content="$2"
    
    # Escape content for JSON
    local escaped_content=$(echo "$content" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
    
    local payload="{\"title\":\"$title\",\"bodyV2\":{\"markdown\":\"$escaped_content\"}}"
    
    local response=$(curl -s -X POST \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "$BASE_URL/rest/notes")
    
    # Check for success
    if echo "$response" | jq -e '.data.createNote.id' >/dev/null 2>&1; then
        echo "$response" | jq -r '.data.createNote.id'
        return 0
    else
        echo "ERROR: $(echo "$response" | jq -r '.error // .message // "Unknown error"')" >&2
        return 1
    fi
}

# Helper function to link note to object
link_note_to_object() {
    local note_id="$1"
    local object_type="$2"
    local object_id="$3"
    
    # Determine target field
    local target_field=""
    case "$object_type" in
        person|people) target_field="targetPersonId" ;;
        company|companies) target_field="targetCompanyId" ;;
        opportunity|opportunities) target_field="targetOpportunityId" ;;
        task|tasks) target_field="targetTaskId" ;;
        workItem|workItems) target_field="targetWorkItemId" ;;
        *)
            echo "ERROR: Unsupported object type: $object_type" >&2
            return 1
            ;;
    esac
    
    local payload="{\"noteId\":\"$note_id\",\"$target_field\":\"$object_id\"}"
    
    local response=$(curl -s -X POST \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "$BASE_URL/rest/noteTargets")
    
    if echo "$response" | jq -e '.data.createNoteTarget.id' >/dev/null 2>&1; then
        return 0
    else
        echo "ERROR: Failed to link note - $(echo "$response" | jq -r '.error // .message' 2>/dev/null)" >&2
        return 1
    fi
}

# Split content into chunks
split_content() {
    local content="$1"
    local max_length="$2"
    local overlap="$3"
    
    # Simple character-based chunking with overlap
    local content_length=${#content}
    local chunks=()
    
    if [ "$content_length" -le "$max_length" ]; then
        echo "$content"
        return 0
    fi
    
    local start=0
    local chunk_num=1
    
    while [ "$start" -lt "$content_length" ]; do
        local end=$((start + max_length))
        
        # Don't go beyond content length
        if [ "$end" -gt "$content_length" ]; then
            end=$content_length
        fi
        
        # Extract chunk
        local chunk="${content:$start:$((end - start))}"
        
        # Try to break at word boundary if not the last chunk
        if [ "$end" -lt "$content_length" ]; then
            # Find last space in chunk
            local last_space=${chunk##* }
            if [ ${#last_space} -gt 0 ] && [ ${#last_space} -lt $((max_length / 2)) ]; then
                chunk="${chunk% *}"
                end=$((start + ${#chunk}))
            fi
        fi
        
        chunks+=("$chunk")
        
        # Move to next chunk with overlap
        start=$((end - overlap))
        if [ "$start" -lt 0 ]; then
            start=0
        fi
        
        chunk_num=$((chunk_num + 1))
    done
    
    # Output chunks
    printf '%s\n' "${chunks[@]}"
}

# Create large note with chunking
create_large_note() {
    local title="$1"
    local content="$2"
    local object_type="$3"
    local object_id="$4"
    
    echo "📝 Creating large note: $title"
    echo "📊 Content length: ${#content} characters"
    
    # Check if content fits in one note
    if [ ${#content} -le "$MAX_NOTE_LENGTH" ]; then
        echo "✅ Content fits in single note"
        local note_id=$(create_note_safe "$title" "$content")
        if [ $? -eq 0 ] && [ -n "$note_id" ]; then
            echo "📋 Note created: $note_id"
            
            if [ -n "$object_type" ] && [ -n "$object_id" ]; then
                if link_note_to_object "$note_id" "$object_type" "$object_id"; then
                    echo "🔗 Note linked to $object_type"
                else
                    echo "⚠️ Note created but failed to link"
                fi
            fi
            return 0
        else
            echo "❌ Failed to create note"
            return 1
        fi
    fi
    
    # Content is too large, need chunking
    echo "🔄 Content too large, splitting into chunks..."
    
    local chunks=()
    while IFS= read -r chunk; do
        chunks+=("$chunk")
    done < <(split_content "$content" "$MAX_NOTE_LENGTH" "$CHUNK_OVERLAP")
    
    echo "📊 Split into ${#chunks[@]} chunks"
    
    local note_ids=()
    local chunk_num=1
    
    for chunk in "${chunks[@]}"; do
        local chunk_title="$title (Part $chunk_num/${#chunks[@]})"
        
        echo "📝 Creating chunk $chunk_num/${#chunks[@]} (${#chunk} characters)..."
        
        local note_id=$(create_note_safe "$chunk_title" "$chunk")
        if [ $? -eq 0 ] && [ -n "$note_id" ]; then
            note_ids+=("$note_id")
            echo "✅ Chunk $chunk_num created: $note_id"
            
            # Link to object if provided
            if [ -n "$object_type" ] && [ -n "$object_id" ]; then
                link_note_to_object "$note_id" "$object_type" "$object_id"
            fi
        else
            echo "❌ Failed to create chunk $chunk_num"
            return 1
        fi
        
        chunk_num=$((chunk_num + 1))
        
        # Small delay to avoid overwhelming the API
        sleep 0.5
    done
    
    echo "🎉 Large note created successfully!"
    echo "📋 Created ${#note_ids[@]} note chunks"
    echo "📝 Note IDs: ${note_ids[*]}"
    
    return 0
}

# Create summary note with file reference
create_summary_note() {
    local title="$1"
    local content="$2"
    local file_path="$3"
    local object_type="$4"
    local object_id="$5"
    
    echo "📝 Creating summary note with file reference..."
    
    # Create summary content
    local summary_content="$content

---

## 📁 Full Document
**File Location:** \`$file_path\`

**Access Instructions:**
1. Navigate to the file path above
2. Open the document for complete content
3. This note contains a summary for quick reference

**Document Type:** $(basename "$file_path")
**Last Updated:** $(date)

---

*This summary note provides quick access to key information. The full document contains additional details, context, and supporting information.*"
    
    if [ ${#summary_content} -le "$MAX_NOTE_LENGTH" ]; then
        create_large_note "$title" "$summary_content" "$object_type" "$object_id"
    else
        # Even summary is too large, create a shorter one
        local short_summary="## 📋 Document Summary

**File:** \`$file_path\`
**Title:** $title
**Updated:** $(date)

**Content Preview:**
${content:0:2000}...

---

**📁 Full Document Available At:**
\`$file_path\`

*The complete document contains extensive details, context, and supporting information. Please refer to the source file for full content.*"
        
        create_large_note "$title" "$short_summary" "$object_type" "$object_id"
    fi
}

# Read file and create note
create_note_from_file() {
    local file_path="$1"
    local title="$2"
    local object_type="$3"
    local object_id="$4"
    local use_summary="$5"
    
    if [ ! -f "$file_path" ]; then
        echo "❌ File not found: $file_path"
        return 1
    fi
    
    if [ -z "$title" ]; then
        title="Document: $(basename "$file_path")"
    fi
    
    echo "📖 Reading file: $file_path"
    local content=$(cat "$file_path")
    
    if [ -z "$content" ]; then
        echo "❌ File is empty"
        return 1
    fi
    
    if [ "$use_summary" = "true" ]; then
        # Create summary note with file reference
        create_summary_note "$title" "$content" "$file_path" "$object_type" "$object_id"
    else
        # Try to create full content note
        create_large_note "$title" "$content" "$object_type" "$object_id"
    fi
}

# Main command handler
case "$1" in
    create-large-note)
        create_large_note "$2" "$3" "$4" "$5"
        ;;
    create-note-from-file)
        create_note_from_file "$2" "$3" "$4" "$5" "$6"
        ;;
    create-summary-note)
        create_summary_note "$2" "$3" "$4" "$5" "$6"
        ;;
    test-chunking)
        test_content="$2"
        if [ -z "$test_content" ]; then
            test_content="This is a test content that is longer than the maximum note length to demonstrate how the chunking system works. It contains multiple sentences and paragraphs to simulate a real document that would need to be split into multiple chunks for proper handling in the Twenty CRM system. Each chunk will be created as a separate note but linked together through the title numbering system."
        fi
        echo "🧪 Testing chunking with ${#test_content} characters..."
        split_content "$test_content" "$MAX_NOTE_LENGTH" "$CHUNK_OVERLAP"
        ;;
    *)
        echo "Twenty CRM Large Notes Handler"
        echo ""
        echo "USAGE:"
        echo "  $0 create-large-note <title> <content> [object_type] [object_id]"
        echo "  $0 create-note-from-file <file_path> [title] [object_type] [object_id] [use_summary]"
        echo "  $0 create-summary-note <title> <content> <file_path> [object_type] [object_id]"
        echo "  $0 test-chunking [test_content]"
        echo ""
        echo "OPTIONS:"
        echo "  use_summary: 'true' to create summary with file reference instead of full content"
        echo ""
        echo "EXAMPLES:"
        echo "  # Create large note with chunking"
        echo "  $0 create-large-note 'Project Plan' '\$(cat plan.md)' workItem abc-123"
        echo ""
        echo "  # Create note from file (auto-chunk if needed)"
        echo "  $0 create-note-from-file /path/to/document.md 'Document Title' workItem abc-123"
        echo ""
        echo "  # Create summary note with file reference"
        echo "  $0 create-summary-note 'Plan Summary' '\$(head -50 plan.md)' /path/to/plan.md workItem abc-123"
        echo ""
        echo "  # Test chunking mechanism"
        echo "  $0 test-chunking"
        echo ""
        echo "CONFIGURATION:"
        echo "  MAX_NOTE_LENGTH: $MAX_NOTE_LENGTH characters"
        echo "  CHUNK_OVERLAP: $CHUNK_OVERLAP characters"
        exit 1
        ;;
esac
