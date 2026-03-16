#!/bin/bash
# Twenty CRM File Upload Enhancement

API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzMzMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
BASE_URL="http://localhost:3000"

# Supported file types
declare -A MIME_TYPES=(
    ["pdf"]="application/pdf"
    ["doc"]="application/msword"
    ["docx"]="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ["xls"]="application/vnd.ms-excel"
    ["xlsx"]="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ["ppt"]="application/vnd.ms-powerpoint"
    ["pptx"]="application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ["txt"]="text/plain"
    ["csv"]="text/csv"
    ["json"]="application/json"
    ["xml"]="application/xml"
    ["png"]="image/png"
    ["jpg"]="image/jpeg"
    ["jpeg"]="image/jpeg"
    ["gif"]="image/gif"
    ["svg"]="image/svg+xml"
    ["mp4"]="video/mp4"
    ["mp3"]="audio/mpeg"
    ["zip"]="application/zip"
    ["rar"]="application/x-rar-compressed"
)

# Helper function to get MIME type
get_mime_type() {
    local file_path="$1"
    local extension="${file_path##*.}"
    extension=$(echo "$extension" | tr '[:upper:]' '[:lower:]')
    
    if [ -n "${MIME_TYPES[$extension]}" ]; then
        echo "${MIME_TYPES[$extension]}"
    else
        # Fallback to file command if available
        if command -v file >/dev/null 2>&1; then
            file -b --mime-type "$file_path" 2>/dev/null || echo "application/octet-stream"
        else
            echo "application/octet-stream"
        fi
    fi
}

# Upload file to Twenty CRM
upload_file() {
    local file_path="$1"
    local file_name="$2"
    local description="$3"
    
    if [ ! -f "$file_path" ]; then
        echo "❌ File not found: $file_path"
        return 1
    fi
    
    # Use provided filename or extract from path
    if [ -z "$file_name" ]; then
        file_name=$(basename "$file_path")
    fi
    
    # Get file size and MIME type
    local file_size=$(stat -c%s "$file_path" 2>/dev/null || stat -f%z "$file_path" 2>/dev/null)
    local mime_type=$(get_mime_type "$file_path")
    
    echo "📤 Uploading file: $file_name"
    echo "📊 Size: $file_size bytes"
    echo "📄 Type: $mime_type"
    
    # Create attachment using multipart/form-data
    local temp_file="/tmp/twenty_upload_$$.json"
    
    # Create JSON metadata
    cat > "$temp_file" << EOF
{
  "name": "$file_name",
  "description": "${description:-"Uploaded via Twenty CRM API"}",
  "mimeType": "$mime_type",
  "size": $file_size
}
EOF
    
    # Upload file with metadata
    local response=$(curl -s -X POST \
      -H "Authorization: Bearer $API_KEY" \
      -F "metadata=@$temp_file" \
      -F "file=@$file_path" \
      "$BASE_URL/rest/attachments")
    
    # Clean up temp file
    rm -f "$temp_file"
    
    # Check response
    if echo "$response" | jq -e '.data.createAttachment.id' >/dev/null 2>&1; then
        local attachment_id=$(echo "$response" | jq -r '.data.createAttachment.id')
        echo "✅ File uploaded successfully!"
        echo "📋 Attachment ID: $attachment_id"
        echo "$response" | jq '.data.createAttachment'
        return 0
    else
        echo "❌ Upload failed:"
        echo "$response" | jq -r '.error // .message // "Unknown error"'
        return 1
    fi
}

# Link attachment to object (person, company, opportunity, task, workItem)
link_attachment_to_object() {
    local attachment_id="$1"
    local object_type="$2"
    local object_id="$3"
    
    echo "🔗 Linking attachment to $object_type..."
    
    # Determine the correct field name
    local target_field=""
    case "$object_type" in
        "person"|"people")
            target_field="targetPersonId"
            ;;
        "company"|"companies")
            target_field="targetCompanyId"
            ;;
        "opportunity"|"opportunities")
            target_field="targetOpportunityId"
            ;;
        "task"|"tasks")
            target_field="targetTaskId"
            ;;
        "workItem"|"workItems")
            target_field="targetWorkItemId"
            ;;
        *)
            echo "❌ Unsupported object type: $object_type"
            echo "Supported types: person, company, opportunity, task, workItem"
            return 1
            ;;
    esac
    
    # Create attachment target link
    local payload="{\"attachmentId\":\"$attachment_id\",\"$target_field\":\"$object_id\"}"
    
    local response=$(curl -s -X POST \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "$BASE_URL/rest/attachmentTargets")
    
    if echo "$response" | jq -e '.data.createAttachmentTarget.id' >/dev/null 2>&1; then
        echo "✅ Attachment linked successfully!"
        return 0
    else
        echo "❌ Failed to link attachment:"
        echo "$response" | jq -r '.error // .message // "Unknown error"'
        return 1
    fi
}

# Upload and link file in one step
upload_and_link_file() {
    local file_path="$1"
    local object_type="$2"
    local object_id="$3"
    local file_name="$4"
    local description="$5"
    
    echo "🚀 Uploading and linking file..."
    
    # Step 1: Upload file
    if ! upload_file "$file_path" "$file_name" "$description"; then
        echo "❌ Upload failed, cannot proceed with linking"
        return 1
    fi
    
    # Extract attachment ID from the last upload response
    local attachment_id=$(echo "$response" | jq -r '.data.createAttachment.id // empty')
    
    if [ -z "$attachment_id" ] || [ "$attachment_id" = "null" ]; then
        echo "❌ Could not extract attachment ID"
        return 1
    fi
    
    # Step 2: Link to object
    if link_attachment_to_object "$attachment_id" "$object_type" "$object_id"; then
        echo "✅ File uploaded and linked successfully!"
        return 0
    else
        echo "❌ Linking failed"
        return 1
    fi
}

# List attachments with details
list_attachments_detailed() {
    echo "📋 Fetching attachments..."
    
    local response=$(curl -s -X GET \
      -H "Authorization: Bearer $API_KEY" \
      "$BASE_URL/rest/attachments")
    
    if echo "$response" | jq -e '.data.attachments' >/dev/null 2>&1; then
        local count=$(echo "$response" | jq '.data.attachments | length')
        echo "📊 Found $count attachments:"
        echo ""
        
        echo "$response" | jq -r '.data.attachments[] | "📄 \(.name // "Unnamed") (\(.mimeType // "unknown")) - \(.size // 0) bytes - ID: \(.id)"'
    else
        echo "❌ Failed to fetch attachments:"
        echo "$response" | jq -r '.error // .message // "Unknown error"'
    fi
}

# Download attachment
download_attachment() {
    local attachment_id="$1"
    local output_path="$2"
    
    if [ -z "$attachment_id" ]; then
        echo "❌ Attachment ID required"
        return 1
    fi
    
    # Get attachment details first
    local details=$(curl -s -X GET \
      -H "Authorization: Bearer $API_KEY" \
      "$BASE_URL/rest/attachments/$attachment_id")
    
    if ! echo "$details" | jq -e '.data' >/dev/null 2>&1; then
        echo "❌ Attachment not found: $attachment_id"
        return 1
    fi
    
    local file_name=$(echo "$details" | jq -r '.data.name // "download"')
    local download_url=$(echo "$details" | jq -r '.data.downloadUrl // empty')
    
    if [ -z "$output_path" ]; then
        output_path="$file_name"
    fi
    
    echo "📥 Downloading: $file_name to $output_path"
    
    # Download the file
    curl -s -X GET \
      -H "Authorization: Bearer $API_KEY" \
      -o "$output_path" \
      "$BASE_URL/rest/attachments/$attachment_id/download"
    
    if [ $? -eq 0 ]; then
        echo "✅ Downloaded successfully: $output_path"
        return 0
    else
        echo "❌ Download failed"
        return 1
    fi
}

# Main command handler
case "$1" in
    upload)
        upload_file "$2" "$3" "$4"
        ;;
    upload-link)
        upload_and_link_file "$2" "$3" "$4" "$5" "$6"
        ;;
    link)
        link_attachment_to_object "$2" "$3" "$4"
        ;;
    list)
        list_attachments_detailed
        ;;
    download)
        download_attachment "$2" "$3"
        ;;
    *)
        echo "Twenty CRM File Upload Tool"
        echo ""
        echo "USAGE:"
        echo "  $0 upload <file_path> [file_name] [description]"
        echo "  $0 upload-link <file_path> <object_type> <object_id> [file_name] [description]"
        echo "  $0 link <attachment_id> <object_type> <object_id>"
        echo "  $0 list"
        echo "  $0 download <attachment_id> [output_path]"
        echo ""
        echo "OBJECT TYPES:"
        echo "  person, company, opportunity, task, workItem"
        echo ""
        echo "SUPPORTED FILE TYPES:"
        echo "  Documents: pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv, json, xml"
        echo "  Images: png, jpg, jpeg, gif, svg"
        echo "  Media: mp4, mp3"
        echo "  Archives: zip, rar"
        echo ""
        echo "EXAMPLES:"
        echo "  # Upload file"
        echo "  $0 upload /path/to/document.pdf"
        echo ""
        echo "  # Upload and link to a task"
        echo "  $0 upload-link /path/to/file.pdf task d3384c35-d9c6-4625-8888-32c6b0ddddcd"
        echo ""
        echo "  # Link existing attachment to work item"
        echo "  $0 link abc-123 workItem 15b55664-1806-4f14-97a4-e002797a5f38"
        echo ""
        echo "  # List all attachments"
        echo "  $0 list"
        echo ""
        echo "  # Download attachment"
        echo "  $0 download abc-123 /path/to/save/file.pdf"
        exit 1
        ;;
esac
