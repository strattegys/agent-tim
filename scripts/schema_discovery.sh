#!/bin/bash
# Twenty CRM Schema Auto-Discovery Tool

# Configuration
API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzMzMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
BASE_URL="http://localhost:3000"
SCHEMA_CACHE="/root/.nanobot/twenty_schema.json"
SCHEMA_HASH="/root/.nanobot/schema_hash.txt"
TOOLS_DIR="/root/.nanobot/tools"

echo "🔍 Starting Twenty CRM Schema Discovery..."

# GraphQL introspection query
INTROSPECTION_QUERY='query IntrospectionQuery {
  __schema {
    types {
      name
      kind
      fields {
        name
        type {
          name
          kind
          ofType {
            name
            kind
          }
        }
      }
    }
  }
}'

echo "📡 Querying GraphQL schema..."
SCHEMA_RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"$INTROSPECTION_QUERY\"}" \
  "$BASE_URL/graphql/")

if [ $? -ne 0 ] || [ -z "$SCHEMA_RESPONSE" ]; then
    echo "❌ Failed to query GraphQL schema"
    exit 1
fi

echo "✅ Schema query successful"

# Extract and process schema
echo "📊 Processing schema data..."
echo "$SCHEMA_RESPONSE" > /tmp/full_schema.json

# Check if schema query was successful
if ! echo "$SCHEMA_RESPONSE" | jq -e '.data.__schema.types' >/dev/null 2>&1; then
    echo "❌ Schema query failed - checking response:"
    echo "$SCHEMA_RESPONSE" | head -5
    exit 1
fi

echo "$SCHEMA_RESPONSE" | jq '.data.__schema.types' > /tmp/raw_schema.json

# Generate structured schema for our use
echo "🔧 Generating structured schema..."
cat > "$SCHEMA_CACHE" << EOF
{
  "discovered_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "version": "$(echo "$SCHEMA_RESPONSE" | sha256sum | cut -d' ' -f1)",
  "objects": {}
}
EOF

# Process each object type
jq -r '.[] | select(.kind == "OBJECT" and .name | test("^[A-Z][a-zA-Z]*$") and (.name | test("^(Query|Mutation|Subscription)$") | not)) | .name' /tmp/raw_schema.json | while read object; do
    echo "📝 Processing object: $object"
    
    # Extract fields for this object
    FIELDS=$(jq -r --arg obj "$object" '.[] | select(.name == $obj) | .fields | map({name: .name, type: .type.name | if . == null then .type.ofType.name else . end})' /tmp/raw_schema.json)
    
    # Add to schema cache
    jq --arg obj "$object" --argjson fields "$FIELDS" '.objects[$obj] = $fields' "$SCHEMA_CACHE" > "$SCHEMA_CACHE.tmp" && mv "$SCHEMA_CACHE.tmp" "$SCHEMA_CACHE"
done

echo "✅ Schema discovery complete"

# Calculate schema hash
SCHEMA_HASH_VALUE=$(echo "$SCHEMA_RESPONSE" | sha256sum | cut -d' ' -f1)
echo "$SCHEMA_HASH_VALUE" > "$SCHEMA_HASH"

# Generate enhanced CRM tool
echo "🛠️ Generating enhanced CRM tool..."
/root/.nanobot/generate_crm_tool.sh "$SCHEMA_CACHE"

# Send alert about schema discovery
curl -s -X POST "https://api.telegram.org/bot5289013326:AAH8C7x2V8QZ3L9K2M1N0O7P6R4S8T2U3V/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\":\"5289013326\",\"text\":\"🔍 Twenty CRM schema discovered and updated\\n\\nObjects found: $(jq -r '.objects | keys | length' "$SCHEMA_CACHE")\\nSchema version: $SCHEMA_HASH_VALUE\\nGenerated at: $(date)\"}" >/dev/null 2>&1

echo "🎉 Schema auto-discovery completed successfully!"
echo "📋 Discovered objects:"
jq -r '.objects | keys | .[]' "$SCHEMA_CACHE" | sed 's/^/- /'

# Show changes from previous schema
if [ -f "/root/.nanobot/twenty_schema_previous.json" ]; then
    echo ""
    echo "🔄 Changes from previous schema:"
    
    # New objects
    NEW_OBJECTS=$(jq -r --slurpfile prev /root/.nanobot/twenty_schema_previous.json '.objects | keys - ($prev[0].objects | keys) | .[]' "$SCHEMA_CACHE")
    if [ -n "$NEW_OBJECTS" ]; then
        echo "➕ New objects:"
        echo "$NEW_OBJECTS" | sed 's/^/  - /'
    fi
    
    # Removed objects
    REMOVED_OBJECTS=$(jq -r --slurpfile prev /root/.nanobot/twenty_schema_previous.json '($prev[0].objects | keys) - .objects | keys | .[]' "$SCHEMA_CACHE")
    if [ -n "$REMOVED_OBJECTS" ]; then
        echo "➖ Removed objects:"
        echo "$REMOVED_OBJECTS" | sed 's/^/  - /'
    fi
fi

# Backup current schema for next comparison
cp "$SCHEMA_CACHE" "/root/.nanobot/twenty_schema_previous.json"

echo ""
echo "✨ Your Twenty CRM integration is now up-to-date with the latest schema!"
