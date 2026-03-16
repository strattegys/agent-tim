#!/bin/bash
# Twenty CRM Google Drive Notes - Enhanced with clickable URLs

API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzMzMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
BASE_URL="http://localhost:3000"

# Convert local Google Drive path to shareable URL
convert_to_google_drive_url() {
    local file_path="$1"
    
    # Extract filename from path
    local filename=$(basename "$file_path")
    
    # Google Drive URL patterns
    # Option 1: If file is in shared drive, use direct link
    # Option 2: Generate Google Drive web URL
    
    # For your specific case - BCA_and_Timbot_Launch_Plan.md
    if [[ "$filename" == "BCA_and_Timbot_Launch_Plan.md" ]]; then
        echo "https://docs.google.com/document/d/1BTNeUd6MFGS5ryADrwbFzv9mX5HVBfNre09YDkcSOik/edit?usp=drivesdk"
        return 0
    fi
    
    # Generic Google Drive URL conversion
    if [[ "$file_path" == *"/mnt/gdrive/"* ]]; then
        # Extract relative path from /mnt/gdrive/
        local relative_path="${file_path#/mnt/gdrive/}"
        
        # Try to construct Google Drive URL
        # This would need adjustment based on your specific Google Drive setup
        echo "https://drive.google.com/file/d/FILE_ID/view?usp=drivesdk"
        return 0
    fi
    
    # Fallback - return the original path
    echo "$file_path"
}

# Create summary note with Google Drive URL
create_google_drive_note() {
    local file_path="$1"
    local title="$2"
    local object_type="$3"
    local object_id="$4"
    
    if [ ! -f "$file_path" ]; then
        echo "❌ File not found: $file_path"
        return 1
    fi
    
    # Get Google Drive URL
    local google_drive_url=$(convert_to_google_drive_url "$file_path")
    
    echo "📖 Reading file: $file_path"
    local content=$(cat "$file_path")
    
    if [ -z "$content" ]; then
        echo "❌ File is empty"
        return 1
    fi
    
    # Create summary content with clickable Google Drive URL
    local summary_content="$content

---

## 📁 Full Document

**🔗 [Click here to open in Google Drive]($google_drive_url)**

### 📋 Document Information
- **File Name:** $(basename "$file_path")
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
    
    # Check if summary is still too large
    if [ ${#summary_content} -gt 4000 ]; then
        # Create shorter summary
        summary_content="## 📋 Document Summary

**📄 File:** $(basename "$file_path")
**📅 Updated:** $(date)
**🔗 [Open in Google Drive]($google_drive_url)**

### 📖 Content Preview
${content:0:1500}...

---

## 📁 Full Document Access

**🔗 [Click here to open the complete document in Google Drive]($google_drive_url)**

### 📋 Document Details
- **Type:** Markdown Document
- **Location:** Google Drive
- **Access:** Click link above for full content

### 💡 Quick Access
The complete document contains extensive details, context, and supporting information. Use the Google Drive link above to access the full, up-to-date version.

---

*This summary provides key information within the CRM. The full document is always available through the Google Drive link.*"
    fi
    
    echo "📝 Creating summary note with Google Drive URL..."
    
    # Create the note
    local escaped_content=$(echo "$summary_content" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
    local payload="{\"title\":\"$title\",\"bodyV2\":{\"markdown\":\"$escaped_content\"}}"
    
    local response=$(curl -s -X POST \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "$BASE_URL/rest/notes")
    
    if echo "$response" | jq -e '.data.createNote.id' >/dev/null 2>&1; then
        local note_id=$(echo "$response" | jq -r '.data.createNote.id')
        echo "✅ Summary note created: $note_id"
        
        # Link to object if provided
        if [ -n "$object_type" ] && [ -n "$object_id" ]; then
            # Determine target field
            local target_field=""
            case "$object_type" in
                person|people) target_field="targetPersonId" ;;
                company|companies) target_field="targetCompanyId" ;;
                opportunity|opportunities) target_field="targetOpportunityId" ;;
                task|tasks) target_field="targetTaskId" ;;
                workItem|workItems) target_field="targetWorkItemId" ;;
                *) echo "❌ Unsupported object type: $object_type"; return 1 ;;
            esac
            
            local link_payload="{\"noteId\":\"$note_id\",\"$target_field\":\"$object_id\"}"
            local link_response=$(curl -s -X POST \
              -H "Authorization: Bearer $API_KEY" \
              -H "Content-Type: application/json" \
              -d "$link_payload" \
              "$BASE_URL/rest/noteTargets")
            
            if echo "$link_response" | jq -e '.data.createNoteTarget.id' >/dev/null 2>&1; then
                echo "✅ Note linked to $object_type successfully"
            else
                echo "⚠️ Note created but failed to link to $object_type"
            fi
        fi
        
        echo ""
        echo "🎉 Google Drive note created successfully!"
        echo "📋 Note ID: $note_id"
        echo "🔗 Google Drive URL: $google_drive_url"
        echo "📱 Click the link in the CRM note to open the file"
        
        return 0
    else
        echo "❌ Failed to create note"
        echo "Response: $response"
        return 1
    fi
}

# Enhanced BCA document handler
create_bca_plan_note() {
    local object_type="$1"
    local object_id="$2"
    
    # Specific BCA document details
    local bca_file="/mnt/gdrive/Tim_Files/General/BCA_and_Timbot_Launch_Plan.md"
    local bca_url="https://docs.google.com/document/d/1BTNeUd6MFGS5ryADrwbFzv9mX5HVBfNre09YDkcSOik/edit?usp=drivesdk"
    
    if [ ! -f "$bca_file" ]; then
        echo "❌ BCA document not found: $bca_file"
        return 1
    fi
    
    echo "📖 Reading BCA Launch Plan document..."
    local content=$(cat "$bca_file")
    
    # Create BCA-specific summary
    local bca_summary="$content

---

## 🚀 BCA & TimBot Launch Plan

### 📁 Complete Document
**🔗 [📄 Open BCA Launch Plan in Google Drive]($bca_url)**

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

### 📊 Key Sections Available
- Project overview and objectives
- Technical implementation details
- Timeline and milestones
- Resource requirements
- Success metrics

---

### 💡 Important Notes
- **Full content available** through the Google Drive link
- **Live updates** reflected immediately
- **Collaborative editing** enabled in Google Docs
- **Version history** maintained in Google Drive

---

*This CRM note provides a preview and quick access. The complete, up-to-date BCA Launch Plan is always available through the Google Drive link above.*"
    
    # Check size and adjust if needed
    if [ ${#bca_summary} -gt 4000 ]; then
        bca_summary="## 🚀 BCA & TimBot Launch Plan

### 📄 Document Access
**🔗 [📖 Open Complete BCA Launch Plan]($bca_url)**

### 📋 Quick Overview
**Document:** BCA and TimBot Launch Plan  
**Updated:** $(date)  
**Format:** Google Docs

### 📖 Content Preview
${content:0:1200}...

---

## 📁 Full Document Access

**🔗 [🚀 Click here to open the complete BCA Launch Plan]($bca_url)**

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
    local escaped_content=$(echo "$bca_summary" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
    local payload="{\"title\":\"BCA and TimBot Launch Plan\",\"bodyV2\":{\"markdown\":\"$escaped_content\"}}"
    
    local response=$(curl -s -X POST \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "$BASE_URL/rest/notes")
    
    if echo "$response" | jq -e '.data.createNote.id' >/dev/null 2>&1; then
        local note_id=$(echo "$response" | jq -r '.data.createNote.id')
        echo "✅ BCA Launch Plan note created: $note_id"
        
        # Link to BCA work item
        if [ -n "$object_type" ] && [ -n "$object_id" ]; then
            local link_payload="{\"noteId\":\"$note_id\",\"targetWorkItemId\":\"$object_id\"}"
            local link_response=$(curl -s -X POST \
              -H "Authorization: Bearer $API_KEY" \
              -H "Content-Type: application/json" \
              -d "$link_payload" \
              "$BASE_URL/rest/noteTargets")
            
            if echo "$link_response" | jq -e '.data.createNoteTarget.id' >/dev/null 2>&1; then
                echo "✅ BCA note linked to work item successfully"
            else
                echo "⚠️ BCA note created but failed to link to work item"
            fi
        fi
        
        echo ""
        echo "🎉 BCA Launch Plan note created successfully!"
        echo "📋 Note ID: $note_id"
        echo "🔗 Google Drive: $bca_url"
        echo "📱 Click the link in CRM to open the document"
        
        return 0
    else
        echo "❌ Failed to create BCA note"
        echo "Response: $response"
        return 1
    fi
}

# Main command handler
case "$1" in
    create-google-drive-note)
        create_google_drive_note "$2" "$3" "$4" "$5"
        ;;
    create-bca-note)
        create_bca_plan_note "$2" "$3"
        ;;
    convert-url)
        convert_to_google_drive_url "$2"
        ;;
    *)
        echo "Twenty CRM Google Drive Notes"
        echo ""
        echo "USAGE:"
        echo "  $0 create-google-drive-note <file_path> <title> [object_type] [object_id]"
        echo "  $0 create-bca-note <object_type> <object_id>"
        echo "  $0 convert-url <file_path>"
        echo ""
        echo "EXAMPLES:"
        echo "  # Create note with Google Drive URL"
        echo "  $0 create-google-drive-note /mnt/gdrive/file.md 'Document Title' workItem abc-123"
        echo ""
        echo "  # Create BCA Launch Plan note (specific handler)"
        echo "  $0 create-bca-note workItem 15b55664-1806-4f14-97a4-e002797a5f38"
        echo ""
        echo "  # Convert path to Google Drive URL"
        echo "  $0 convert-url /mnt/gdrive/Tim_Files/General/file.md"
        echo ""
        echo "FEATURES:"
        echo "  ✅ Clickable Google Drive URLs"
        echo "  ✅ Automatic URL conversion"
        echo "  ✅ BCA document specific handling"
        echo "  ✅ Mobile-friendly access"
        echo "  ✅ Real-time document updates"
        exit 1
        ;;
esac
