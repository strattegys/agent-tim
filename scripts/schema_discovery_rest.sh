#!/bin/bash
# Twenty CRM Schema Discovery via REST API

API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzMzMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
BASE_URL="http://localhost:3000"
SCHEMA_CACHE="/root/.nanobot/twenty_schema.json"

echo "🔍 Starting REST API Schema Discovery..."

# Test common REST endpoints to discover available objects
echo "📡 Discovering available REST endpoints..."

# List of common Twenty CRM endpoints to test
ENDPOINTS=(
    "people"
    "companies"
    "opportunities"
    "tasks"
    "notes"
    "workItems"
    "projects"
    "deals"
    "contacts"
    "accounts"
)

echo "🔧 Generating structured schema..."
cat > "$SCHEMA_CACHE" << EOF
{
  "discovered_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "version": "$(date +%s)",
  "objects": {}
}
EOF

# Test each endpoint
for endpoint in "${ENDPOINTS[@]}"; do
    echo "📝 Testing endpoint: /rest/$endpoint"
    
    RESPONSE=$(curl -s -X GET \
      -H "Authorization: Bearer $API_KEY" \
      "$BASE_URL/rest/$endpoint")
    
    # Check if endpoint exists and returns data
    if echo "$RESPONSE" | jq -e '.data' >/dev/null 2>&1; then
        echo "✅ Found: $endpoint"
        
        # Get sample data to infer schema
        SAMPLE=$(echo "$RESPONSE" | jq '.data[0] // empty')
        if [ -n "$SAMPLE" ] && [ "$SAMPLE" != "null" ]; then
            # Extract field names from sample
            FIELDS=$(echo "$SAMPLE" | jq -r 'keys | map({name: .})')
            
            # Determine object name (capitalize first letter)
            OBJECT_NAME=$(echo "$endpoint" | sed 's/s$//' | sed 's/\(.\)/\u\1/')
            
            # Add to schema
            jq --arg obj "$OBJECT_NAME" --argjson fields "$FIELDS" '.objects[$obj] = $fields' "$SCHEMA_CACHE" > "$SCHEMA_CACHE.tmp" && mv "$SCHEMA_CACHE.tmp" "$SCHEMA_CACHE"
        fi
    else
        echo "❌ Not found: $endpoint"
    fi
done

echo "✅ Schema discovery complete"

# Generate tool
echo "🛠️ Generating dynamic CRM tool..."
/root/.nanobot/generate_crm_tool.sh "$SCHEMA_CACHE"

# Show results
echo ""
echo "📋 Discovered objects:"
jq -r '.objects | keys | .[]' "$SCHEMA_CACHE" | sed 's/^/- /'

echo ""
echo "🎉 REST API schema discovery complete!"
echo "📄 Schema saved to: $SCHEMA_CACHE"
echo "🛠️ Dynamic tool: /root/.nanobot/tools/twenty_crm_dynamic.sh"
