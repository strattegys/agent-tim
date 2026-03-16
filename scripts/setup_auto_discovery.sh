#!/bin/bash
# Setup Twenty CRM Schema Auto-Discovery System

echo "🚀 Setting up Twenty CRM Schema Auto-Discovery System..."

# Create necessary directories
mkdir -p /root/.nanobot/tools
mkdir -p /root/.nanobot/logs

# Deploy scripts
echo "📦 Deploying auto-discovery scripts..."

# Copy scripts to server
scp schema_discovery.sh root@137.184.187.233:/root/.nanobot/
scp generate_crm_tool.sh root@137.184.187.233:/root/.nanobot/
scp schema_monitor.sh root@137.184.187.233:/root/.nanobot/

# Make scripts executable
ssh root@137.184.187.233 "chmod +x /root/.nanobot/schema_discovery.sh"
ssh root@137.184.187.233 "chmod +x /root/.nanobot/generate_crm_tool.sh"
ssh root@137.184.187.233 "chmod +x /root/.nanobot/schema_monitor.sh"

# Initial schema discovery
echo "🔍 Running initial schema discovery..."
ssh root@137.184.187.233 "/root/.nanobot/schema_discovery.sh"

# Setup cron job for monitoring
echo "⏰ Setting up schema monitoring cron job..."
ssh root@137.184.187.233 "crontab -l > /tmp/crontab_backup 2>/dev/null || true"
ssh root@137.184.187.233 "echo '# Check Twenty CRM schema changes every hour' >> /tmp/crontab_backup"
ssh root@137.184.187.233 "echo '0 * * * * /root/.nanobot/schema_monitor.sh >> /root/.nanobot/logs/schema_monitor.log 2>&1' >> /tmp/crontab_backup"
ssh root@137.184.187.233 "crontab /tmp/crontab_backup"

# Test the dynamic tool
echo "🧪 Testing dynamic CRM tool..."
ssh root@137.184.187.233 "/root/.nanobot/tools/twenty_crm_dynamic.sh --help | head -10"

# Create validation script
cat > test_auto_discovery.sh << 'EOF'
#!/bin/bash
echo "🧪 Testing Auto-Discovery System..."

echo "1. Testing schema discovery..."
ssh root@137.184.187.233 "/root/.nanobot/schema_discovery.sh" | head -5

echo ""
echo "2. Testing dynamic tool..."
ssh root@137.184.187.233 "/root/.nanobot/tools/twenty_crm_dynamic.sh --help | grep 'DISCOVERED OBJECTS' -A 5"

echo ""
echo "3. Testing schema monitor..."
ssh root@137.184.187.233 "/root/.nanobot/schema_monitor.sh"

echo ""
echo "4. Testing note linking with discovered objects..."
# Get a task ID for testing
TASK_ID=$(ssh root@137.184.187.233 "/root/.nanobot/tools/twenty_crm_dynamic.sh list-tasks | jq -r '.data[0].id // empty' 2>/dev/null")
if [ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ]; then
    echo "Testing note linking with task: $TASK_ID"
    ssh root@137.184.187.233 "/root/.nanobot/tools/twenty_crm_dynamic.sh create-linked-note '$TASK_ID' task 'Auto-Discovery Test' 'This note was created using the auto-discovered schema!'"
else
    echo "No tasks available for testing"
fi

echo ""
echo "✅ Auto-Discovery System Test Complete!"
EOF

chmod +x test_auto_discovery.sh

echo ""
echo "🎉 Auto-Discovery System Setup Complete!"
echo ""
echo "📋 What's been set up:"
echo "  ✅ Schema discovery script - Detects all objects and fields"
echo "  ✅ Dynamic tool generator - Auto-generates CRM tool from schema"
echo "  ✅ Schema monitor - Checks for changes hourly"
echo "  ✅ Cron job - Automated monitoring"
echo "  ✅ Test script - Validation system"
echo ""
echo "🔄 How it works:"
echo "  1. Schema discovery runs and queries GraphQL introspection"
echo "  2. Dynamic tool is generated with all discovered objects"
echo "  3. Monitor runs hourly to detect schema changes"
echo "  4. When changes detected, auto-regeneration occurs"
echo "  5. Alerts sent about schema updates"
echo ""
echo "📞 Next steps:"
echo "  1. Run: bash test_auto_discovery.sh"
echo "  2. Check: /root/.nanobot/twenty_schema.json"
echo "  3. Use: /root/.nanobot/tools/twenty_crm_dynamic.sh"
echo "  4. Monitor: /root/.nanobot/logs/schema_monitor.log"
echo ""
echo "🚀 Your Twenty CRM integration is now future-proof!"
