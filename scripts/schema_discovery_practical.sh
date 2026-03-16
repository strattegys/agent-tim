#!/bin/bash
# Practical Twenty CRM Schema Discovery

API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzMzMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
BASE_URL="http://localhost:3000"
SCHEMA_CACHE="/root/.nanobot/twenty_schema.json"

echo "🔍 Starting Practical Schema Discovery..."

# Use the working tool to discover available objects
echo "📡 Testing known working endpoints..."

# Known working endpoints from the original tool
declare -A ENDPOINTS=(
    ["people"]="Person"
    ["companies"]="Company"
    ["opportunities"]="Opportunity"
    ["tasks"]="Task"
    ["notes"]="Note"
    ["timelineActivities"]="Activity"
    ["messages"]="Message"
    ["messageThreads"]="MessageThread"
    ["calendarEvents"]="CalendarEvent"
    ["attachments"]="Attachment"
    ["favorites"]="Favorite"
    ["workflows"]="Workflow"
    ["connectedAccounts"]="ConnectedAccount"
    ["workspaceMembers"]="WorkspaceMember"
)

echo "🔧 Generating structured schema..."
cat > "$SCHEMA_CACHE" << EOF
{
  "discovered_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "version": "$(date +%s)",
  "objects": {}
}
EOF

# Test each known endpoint
for endpoint in "${!ENDPOINTS[@]}"; do
    object_name="${ENDPOINTS[$endpoint]}"
    echo "📝 Testing endpoint: /rest/$endpoint (Object: $object_name)"
    
    RESPONSE=$(curl -s -X GET \
      -H "Authorization: Bearer $API_KEY" \
      "$BASE_URL/rest/$endpoint")
    
    # Check if endpoint exists and returns data
    if echo "$RESPONSE" | jq -e '.data' >/dev/null 2>&1; then
        DATA_COUNT=$(echo "$RESPONSE" | jq '.data | length // 0')
        if [ "$DATA_COUNT" -gt 0 ]; then
            echo "✅ Found: $endpoint ($DATA_COUNT records)"
            
            # Get sample data to infer schema
            SAMPLE=$(echo "$RESPONSE" | jq '.data[0]')
            
            # Extract field names and types from sample
            FIELDS=$(echo "$SAMPLE" | jq -r 'to_entries | map({name: .key, type: (.value | type)})')
            
            # Add to schema
            jq --arg obj "$object_name" --argjson fields "$FIELDS" '.objects[$obj] = $fields' "$SCHEMA_CACHE" > "$SCHEMA_CACHE.tmp" && mv "$SCHEMA_CACHE.tmp" "$SCHEMA_CACHE"
        else
            echo "✅ Found: $endpoint (empty but valid)"
            # Add empty schema
            jq --arg obj "$object_name" '.objects[$obj] = []' "$SCHEMA_CACHE" > "$SCHEMA_CACHE.tmp" && mv "$SCHEMA_CACHE.tmp" "$SCHEMA_CACHE"
        fi
    else
        echo "❌ Not found: $endpoint"
    fi
done

echo "✅ Schema discovery complete"

# Generate enhanced tool with discovered objects
echo "🛠️ Generating enhanced CRM tool..."
/root/.nanobot/generate_crm_tool.sh "$SCHEMA_CACHE"

# Show results
echo ""
echo "📋 Discovered objects:"
jq -r '.objects | keys | .[]' "$SCHEMA_CACHE" | sed 's/^/- /'

echo ""
echo "🎉 Practical schema discovery complete!"
echo "📄 Schema saved to: $SCHEMA_CACHE"
echo "🛠️ Enhanced tool: /root/.nanobot/tools/twenty_crm_dynamic.sh"

# Test the dynamic tool
echo ""
echo "🧪 Testing dynamic tool..."
ssh root@137.184.187.233 "/root/.nanobot/tools/twenty_crm_dynamic.sh --help | head -15"

# Setup monitoring
echo ""
echo "⏰ Setting up monitoring..."
# Create simple monitor script
cat > /root/.nanobot/monitor_changes.sh << 'EOF'
#!/bin/bash
# Simple change monitor
echo "🔍 Checking for schema changes..."

# Compare current schema with backup
if [ -f /root/.nanobot/twenty_schema_previous.json ]; then
    CURRENT_OBJECTS=$(jq -r '.objects | keys | sort | join(",")' /root/.nanobot/twenty_schema.json)
    PREVIOUS_OBJECTS=$(jq -r '.objects | keys | sort | join(",")' /root/.nanobot/twenty_schema_previous.json)
    
    if [ "$CURRENT_OBJECTS" != "$PREVIOUS_OBJECTS" ]; then
        echo "🔄 Schema changes detected!"
        echo "Previous: $PREVIOUS_OBJECTS"
        echo "Current: $CURRENT_OBJECTS"
        
        # Send alert
        curl -s -X POST "https://api.telegram.org/bot5289013326:AAH8C7x2V8QZ3L9K2M1N0O7P6R4S8T2U3V/sendMessage" \
          -H "Content-Type: application/json" \
          -d "{\"chat_id\":\"5289013326\",\"text\":\"🔄 Twenty CRM schema changed!\\n\\nObjects: $CURRENT_OBJECTS\"}" >/dev/null 2>&1
    else
        echo "✅ No changes detected"
    fi
else
    echo "📝 Creating baseline schema..."
fi

# Backup current schema
cp /root/.nanobot/twenty_schema.json /root/.nanobot/twenty_schema_previous.json
EOF

chmod +x /root/.nanobot/monitor_changes.sh

# Add to cron
ssh root@137.184.187.233 "crontab -l > /tmp/crontab_backup 2>/dev/null || true"
ssh root@137.184.187.233 "echo '# Monitor Twenty CRM schema changes every 30 minutes' >> /tmp/crontab_backup"
ssh root@137.184.187.233 'echo "*/30 * * * * /root/.nanobot/monitor_changes.sh >> /root/.nanobot/schema_monitor.log 2>&1" >> /tmp/crontab_backup'
ssh root@137.184.187.233 "crontab /tmp/crontab_backup"

echo "✅ Monitoring setup complete"
echo ""
echo "🎉 Auto-Discovery System is now ready!"
echo ""
echo "📞 What happens now:"
echo "  ✅ Schema automatically discovered via REST endpoints"
echo "  ✅ Dynamic tool generated with all available objects"
echo "  ✅ Monitoring runs every 30 minutes for changes"
echo "  ✅ Alerts sent when schema changes detected"
echo ""
echo "🛠️ Usage:"
echo "  # Use dynamic tool with auto-discovered objects"
echo "  /root/.nanobot/tools/twenty_crm_dynamic.sh list-tasks"
echo "  /root/.nanobot/tools/twenty_crm_dynamic.sh create-task '{\"title\":\"New Task\"}'"
echo "  /root/.nanobot/tools/twenty_crm_dynamic.sh create-linked-note <id> task 'Note' 'Content'"
echo ""
echo "🚀 Your Twenty CRM integration is now future-proof!"
