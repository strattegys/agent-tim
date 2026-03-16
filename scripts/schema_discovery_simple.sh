#!/bin/bash
# Simple Twenty CRM Schema Discovery

API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzMzMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
BASE_URL="http://localhost:3000"
SCHEMA_CACHE="/root/.nanobot/twenty_schema.json"

echo "🔍 Starting Simple Schema Discovery..."

# Create GraphQL query file
cat > /tmp/introspection.json << 'EOF'
{
  "query": "query IntrospectionQuery { __schema { types { name kind fields { name type { name kind ofType { name kind } } } } } }"
}
EOF

echo "📡 Querying GraphQL schema..."
SCHEMA_RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d @/tmp/introspection.json \
  "$BASE_URL/graphql/")

if [ $? -ne 0 ] || [ -z "$SCHEMA_RESPONSE" ]; then
    echo "❌ Failed to query GraphQL schema"
    exit 1
fi

echo "✅ Schema query successful"

# Check for errors
if echo "$SCHEMA_RESPONSE" | jq -e '.errors' >/dev/null 2>&1; then
    echo "❌ GraphQL errors:"
    echo "$SCHEMA_RESPONSE" | jq -r '.errors[].message'
    exit 1
fi

# Extract types
TYPES=$(echo "$SCHEMA_RESPONSE" | jq '.data.__schema.types')

# Generate schema cache
echo "🔧 Generating structured schema..."
cat > "$SCHEMA_CACHE" << EOF
{
  "discovered_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "version": "$(echo "$SCHEMA_RESPONSE" | sha256sum | cut -d' ' -f1)",
  "objects": {}
}
EOF

# Process objects
echo "$TYPES" | jq -r '.[] | select(.kind == "OBJECT" and .name | test("^[A-Z][a-zA-Z]*$") and (.name | test("^(Query|Mutation|Subscription)$") | not)) | .name' | while read object; do
    echo "📝 Processing object: $object"
    
    # Extract fields
    FIELDS=$(echo "$TYPES" | jq -r --arg obj "$object" '.[] | select(.name == $obj) | .fields | map({name: .name, type: .type.name // .type.ofType.name})')
    
    # Add to schema
    jq --arg obj "$object" --argjson fields "$FIELDS" '.objects[$obj] = $fields' "$SCHEMA_CACHE" > "$SCHEMA_CACHE.tmp" && mv "$SCHEMA_CACHE.tmp" "$SCHEMA_CACHE"
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
echo "🎉 Auto-discovery complete!"
echo "📄 Schema saved to: $SCHEMA_CACHE"
echo "🛠️ Dynamic tool: /root/.nanobot/tools/twenty_crm_dynamic.sh"
