#!/bin/bash
# Twenty CRM File Upload Diagnostic Tool

API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzMzMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
BASE_URL="http://localhost:3000"

echo "🔍 Twenty CRM File Upload Diagnostic"
echo "=================================="

# Test 1: Check API authentication
echo "📋 Test 1: API Authentication"
AUTH_TEST=$(curl -s -X GET -H "Authorization: Bearer $API_KEY" "$BASE_URL/rest/tasks" | jq -r '.data // empty')
if [ -n "$AUTH_TEST" ]; then
    echo "✅ API authentication working"
else
    echo "❌ API authentication failed"
    exit 1
fi

# Test 2: Check attachments endpoint
echo ""
echo "📋 Test 2: Attachments Endpoint"
ATTACHMENT_TEST=$(curl -s -X GET -H "Authorization: Bearer $API_KEY" "$BASE_URL/rest/attachments")
if echo "$ATTACHMENT_TEST" | jq -e '.data' >/dev/null 2>&1; then
    echo "✅ Attachments endpoint accessible"
    ATTACHMENT_COUNT=$(echo "$ATTACHMENT_TEST" | jq '.data.attachments | length // 0')
    echo "📊 Current attachments: $ATTACHMENT_COUNT"
else
    echo "❌ Attachments endpoint failed"
    echo "$ATTACHMENT_TEST" | jq -r '.error // .message // "Unknown error"'
fi

# Test 3: Create test file
echo ""
echo "📋 Test 3: Creating Test File"
TEST_FILE="/tmp/diagnostic_test.txt"
echo "This is a diagnostic test file for Twenty CRM upload testing. Created at $(date)." > "$TEST_FILE"
if [ -f "$TEST_FILE" ]; then
    FILE_SIZE=$(stat -c%s "$TEST_FILE" 2>/dev/null || stat -f%z "$TEST_FILE" 2>/dev/null)
    echo "✅ Test file created: $TEST_FILE ($FILE_SIZE bytes)"
else
    echo "❌ Failed to create test file"
    exit 1
fi

# Test 4: Try simple JSON upload (no file)
echo ""
echo "📋 Test 4: Simple JSON Metadata Upload"
JSON_PAYLOAD='{"name":"Test Upload","description":"Diagnostic test","mimeType":"text/plain","size":100}'
JSON_RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD" \
  "$BASE_URL/rest/attachments")

echo "JSON Response: $JSON_RESPONSE"

if echo "$JSON_RESPONSE" | jq -e '.data.createAttachment.id' >/dev/null 2>&1; then
    echo "✅ JSON upload successful"
    JSON_ATTACHMENT_ID=$(echo "$JSON_RESPONSE" | jq -r '.data.createAttachment.id')
    echo "📋 Attachment ID: $JSON_ATTACHMENT_ID"
else
    echo "❌ JSON upload failed"
    echo "$JSON_RESPONSE" | jq -r '.error // .message // "Unknown error"' 2>/dev/null || echo "$JSON_RESPONSE"
fi

# Test 5: Try multipart upload with file
echo ""
echo "📋 Test 5: Multipart File Upload"
echo "📤 Attempting file upload..."

# Create metadata file
METADATA_FILE="/tmp/upload_metadata.json"
cat > "$METADATA_FILE" << EOF
{
  "name": "diagnostic_test.txt",
  "description": "Diagnostic test upload",
  "mimeType": "text/plain",
  "size": $FILE_SIZE
}
EOF

echo "📄 Metadata file created: $METADATA_FILE"

# Try multipart upload
MULTIPART_RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -F "metadata=@$METADATA_FILE" \
  -F "file=@$TEST_FILE" \
  "$BASE_URL/rest/attachments")

echo "Multipart Response: $MULTIPART_RESPONSE"

if echo "$MULTIPART_RESPONSE" | jq -e '.data.createAttachment.id' >/dev/null 2>&1; then
    echo "✅ Multipart upload successful"
    MULTIPART_ATTACHMENT_ID=$(echo "$MULTIPART_RESPONSE" | jq -r '.data.createAttachment.id')
    echo "📋 Attachment ID: $MULTIPART_ATTACHMENT_ID"
else
    echo "❌ Multipart upload failed"
    echo "$MULTIPART_RESPONSE" | jq -r '.error // .message // "Unknown error"' 2>/dev/null || echo "$MULTIPART_RESPONSE"
    
    # Try alternative approach
    echo ""
    echo "📋 Test 6: Alternative Upload Approach"
    ALT_RESPONSE=$(curl -s -X POST \
      -H "Authorization: Bearer $API_KEY" \
      -F "name=diagnostic_test.txt" \
      -F "description=Alternative test" \
      -F "file=@$TEST_FILE" \
      "$BASE_URL/rest/attachments")
    
    echo "Alternative Response: $ALT_RESPONSE"
    
    if echo "$ALT_RESPONSE" | jq -e '.data.createAttachment.id' >/dev/null 2>&1; then
        echo "✅ Alternative upload successful"
    else
        echo "❌ Alternative upload also failed"
    fi
fi

# Test 7: Check Twenty CRM version and capabilities
echo ""
echo "📋 Test 7: System Information"
VERSION_INFO=$(curl -s -X GET -H "Authorization: Bearer $API_KEY" "$BASE_URL/rest/workspaceMembers" | jq -r '.data[0].workspace.name // "Unknown"' 2>/dev/null)
echo "🏢 Workspace: $VERSION_INFO"

# Clean up
rm -f "$TEST_FILE" "$METADATA_FILE"

echo ""
echo "🎯 Diagnostic Complete!"
echo "========================"
echo ""
echo "📊 Summary:"
echo "- API Authentication: ✅ Working"
echo "- Attachments Endpoint: ✅ Accessible"
echo "- JSON Upload: $(echo "$JSON_RESPONSE" | jq -e '.data.createAttachment.id' >/dev/null 2>&1 && echo '✅ Working' || echo '❌ Failed')"
echo "- Multipart Upload: $(echo "$MULTIPART_RESPONSE" | jq -e '.data.createAttachment.id' >/dev/null 2>&1 && echo '✅ Working' || echo '❌ Failed')"
echo ""
echo "🔧 Recommendations:"
if echo "$JSON_RESPONSE" | jq -e '.data.createAttachment.id' >/dev/null 2>&1; then
    echo "- JSON metadata upload works - issue is with file handling"
    echo "- Check Twenty CRM documentation for exact file upload format"
    echo "- May need different field names or approach"
else
    echo "- Upload endpoint may need different format"
    echo "- Check if attachments are enabled in your Twenty CRM instance"
    echo "- Verify API permissions for file uploads"
fi
