#!/bin/bash
# Twenty CRM Schema Change Monitor

# Configuration
API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzMzMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
BASE_URL="http://localhost:3000"
SCHEMA_HASH="/root/.nanobot/schema_hash.txt"
LOG_FILE="/root/.nanobot/schema_monitor.log"

echo "🔍 Checking Twenty CRM schema for changes..."

# Get current schema hash
INTROSPECTION_QUERY='{
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

CURRENT_SCHEMA=$(curl -s -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\":$INTROSPECTION_QUERY}" \
  "$BASE_URL/graphql/")

if [ $? -ne 0 ] || [ -z "$CURRENT_SCHEMA" ]; then
    echo "❌ Failed to query current schema"
    echo "$(date): ERROR - Failed to query schema" >> "$LOG_FILE"
    exit 1
fi

CURRENT_HASH=$(echo "$CURRENT_SCHEMA" | sha256sum | cut -d' ' -f1)

# Check if we have a previous hash
if [ ! -f "$SCHEMA_HASH" ]; then
    echo "📝 No previous schema hash found - initializing"
    echo "$CURRENT_HASH" > "$SCHEMA_HASH"
    echo "$(date): INFO - Schema hash initialized: $CURRENT_HASH" >> "$LOG_FILE"
    exit 0
fi

# Compare hashes
PREVIOUS_HASH=$(cat "$SCHEMA_HASH")

if [ "$CURRENT_HASH" != "$PREVIOUS_HASH" ]; then
    echo "🔄 Schema change detected! Hash changed from $PREVIOUS_HASH to $CURRENT_HASH"
    echo "$(date): INFO - Schema change detected" >> "$LOG_FILE"
    
    # Run schema discovery
    echo "🛠️ Running schema discovery..."
    /root/.nanobot/schema_discovery.sh
    
    # Send alert about schema changes
    ALERT_MESSAGE="🔄 Twenty CRM schema updated!

Previous hash: $PREVIOUS_HASH
New hash: $CURRENT_HASH
Updated at: $(date)

The CRM tool has been automatically regenerated with the latest schema support."

    curl -s -X POST "https://api.telegram.org/bot5289013326:AAH8C7x2V8QZ3L9K2M1N0O7P6R4S8T2U3V/sendMessage" \
      -H "Content-Type: application/json" \
      -d "{\"chat_id\":\"5289013326\",\"text\":\"$ALERT_MESSAGE\"}" >/dev/null 2>&1
    
    echo "$(date): INFO - Schema discovery completed and alerts sent" >> "$LOG_FILE"
    echo "✅ Schema update processed successfully"
else
    echo "✅ No schema changes detected"
    echo "$(date): INFO - No changes detected" >> "$LOG_FILE"
fi

# Optional: Show schema statistics
if command -v jq >/dev/null 2>&1; then
    OBJECT_COUNT=$(echo "$CURRENT_SCHEMA" | jq '.data.__schema.types | map(select(.kind == "OBJECT" and .name | test("^[A-Z][a-zA-Z]*$") and .name | test("^(Query|Mutation|Subscription)$") | not)) | length')
    echo "📊 Current schema has $OBJECT_COUNT object types"
    echo "$(date): INFO - Schema statistics: $OBJECT_COUNT objects" >> "$LOG_FILE"
fi
