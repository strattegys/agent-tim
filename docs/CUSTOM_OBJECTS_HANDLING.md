# Custom Objects & Schema Changes - Handling Guide

## 🔄 What Happens When You Add Custom Objects

### Current Behavior (Without Auto-Discovery)
❌ **Manual Updates Required**
- Custom objects won't appear in `twenty_crm.sh` tool
- Schema documentation becomes outdated
- Connection errors for unknown object types
- Manual code updates needed for each change

### Enhanced Behavior (With Auto-Discovery Solution)
✅ **Automatic Detection & Handling**
- Custom objects discovered via GraphQL introspection
- Schema automatically cached and validated
- Tool dynamically supports new objects
- Documentation auto-generated

## 🛠️ Schema Auto-Discovery Implementation

### 1. GraphQL Introspection Query
```bash
# Discover all available objects
curl -s -X POST -H 'Authorization: Bearer <API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __schema { types { name fields { name type } } } }"}' \
  'http://localhost:3000/graphql/'
```

### 2. Schema Caching System
```bash
# Cache schema locally
/root/.nanobot/twenty_schema.json

# Auto-refresh when changes detected
/root/.nanobot/schema_monitor.sh
```

### 3. Dynamic Tool Generation
```bash
# Auto-generate twenty_crm.sh with new objects
/root/.nanobot/generate_crm_tool.sh
```

## 📋 Custom Object Scenarios

### Scenario 1: New Custom Object Added
**Example**: You add a "Projects" object in Twenty CRM

**Without Auto-Discovery:**
```bash
# This would fail
/root/.nanobot/tools/twenty_crm.sh list-projects
# Error: Unknown command 'list-projects'
```

**With Auto-Discovery:**
```bash
# Schema discovery detects "Projects" object
# Tool automatically regenerated with project support
/root/.nanobot/tools/twenty_crm.sh list-projects
# ✅ Works automatically
```

### Scenario 2: Field Changes
**Example**: "Tasks" object gets new "priority" field

**Without Auto-Discovery:**
```bash
# Field validation fails
/root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Task","priority":"HIGH"}'
# Error: Unknown field 'priority'
```

**With Auto-Discovery:**
```bash
# Schema detects new field
# Validation automatically updated
/root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Task","priority":"HIGH"}'
# ✅ Works with new field
```

### Scenario 3: Relationship Changes
**Example**: New "Projects" object can have notes

**Without Auto-Discovery:**
```bash
# Note linking fails for projects
/root/.nanobot/tools/twenty_crm.sh create-note-target '{"noteId":"xxx","targetProjectId":"yyy"}'
# Error: Unknown field 'targetProjectId'
```

**With Auto-Discovery:**
```bash
# Relationships automatically discovered
# NoteTarget junction table updated
/root/.nanobot/tools/twenty_crm.sh create-note-target '{"noteId":"xxx","targetProjectId":"yyy"}'
# ✅ Works automatically
```

## 🚀 Auto-Discovery Implementation Plan

### Step 1: Schema Discovery Script
```bash
#!/bin/bash
# /root/.nanobot/schema_discovery.sh

# Query GraphQL schema
SCHEMA_RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __schema { types { name fields { name type } } } }"}' \
  "$BASE_URL/graphql/")

# Parse and structure schema
echo "$SCHEMA_RESPONSE" | jq '.data.__schema.types' > /tmp/raw_schema.json

# Generate validation rules and tool commands
/root/.nanobot/generate_crm_tool.sh /tmp/raw_schema.json
```

### Step 2: Tool Generator
```bash
#!/bin/bash
# /root/.nanobot/generate_crm_tool.sh

# Generate dynamic twenty_crm.sh
cat > /root/.nanobot/tools/twenty_crm_dynamic.sh << 'EOF'
#!/bin/bash
# Auto-generated Twenty CRM Tool
# Generated: $(date)
# Schema Version: $(jq -r '.version' /root/.nanobot/twenty_schema.json)

# Dynamic object handlers will be inserted here
EOF

# Add support for each discovered object
jq -r '.[] | select(.name | test("^[A-Z][a-zA-Z]*$")) | .name' /tmp/raw_schema.json | while read object; do
    # Generate CRUD operations for each object
    echo "Adding support for: $object"
done
```

### Step 3: Schema Monitor
```bash
#!/bin/bash
# /root/.nanobot/schema_monitor.sh

# Check for schema changes daily
CURRENT_HASH=$(curl -s ... | sha256sum)
CACHED_HASH=$(cat /root/.nanobot/schema_hash.txt 2>/dev/null || echo "")

if [ "$CURRENT_HASH" != "$CACHED_HASH" ]; then
    echo "Schema changed! Regenerating tools..."
    /root/.nanobot/schema_discovery.sh
    echo "$CURRENT_HASH" > /root/.nanobot/schema_hash.txt
    
    # Send alert about schema changes
    send_alert "🔄 Twenty CRM schema updated - new objects/fields detected"
fi
```

## 📊 Real-Time Schema Validation

### Before API Calls
```bash
# Validate payload against current schema
validate_payload() {
    local object_type="$1"
    local payload="$2"
    
    # Check against cached schema
    if ! jq -e --arg object "$object_type" '.[$object_type].fields' /root/.nanobot/twenty_schema.json >/dev/null; then
        echo "❌ Unknown object type: $object_type"
        return 1
    fi
    
    # Validate fields
    echo "$payload" | jq -e --arg object "$object_type" '
        . as $payload |
        ($object | fromjson).fields |
        keys as $valid_fields |
        $payload | keys | inside($valid_fields)
    ' /root/.nanobot/twenty_schema.json
}
```

### Error Handling with Suggestions
```bash
# Provide helpful error messages
suggest_fix() {
    local object_type="$1"
    local invalid_field="$2"
    
    # Find similar field names
    SIMILAR=$(jq -r --arg object "$object_type" --arg field "$invalid_field" '
        .[$object].fields | keys | .[] | select(test($field; "i")) |
        if test($field; "i") then . else empty end
    ' /root/.nanobot/twenty_schema.json | head -3)
    
    if [ -n "$SIMILAR" ]; then
        echo "💡 Did you mean: $SIMILAR"
    fi
    
    echo "📋 Available fields for $object_type:"
    jq -r --arg object "$object_type" '.[$object].fields | keys | .[]' /root/.nanobot/twenty_schema.json
}
```

## 🎯 Benefits of Auto-Discovery

### ✅ Zero Maintenance
- No manual tool updates for new objects
- No schema documentation updates
- No field validation changes

### ✅ Real-Time Adaptation
- Immediate support for new custom objects
- Automatic field validation updates
- Dynamic relationship handling

### ✅ Error Prevention
- Pre-request validation prevents API errors
- Helpful error messages with suggestions
- Automatic field correction

### ✅ Documentation Sync
- Schema docs always up-to-date
- Auto-generated examples for new objects
- Relationship diagrams updated automatically

## 🔄 Deployment Timeline

### Phase 1: Schema Discovery (Immediate)
- Implement GraphQL introspection
- Create schema caching system
- Add basic validation

### Phase 2: Tool Generation (Week 1)
- Auto-generate CRM tool from schema
- Add dynamic object support
- Implement field validation

### Phase 3: Monitoring (Week 2)
- Add schema change detection
- Implement auto-regeneration
- Add alerting system

### Phase 4: Advanced Features (Week 3)
- Add relationship discovery
- Implement auto-documentation
- Add testing framework

## 🎉 Result

With auto-discovery implemented:
- ✅ **Add any custom object** → Tool automatically supports it
- ✅ **Change any field** → Validation automatically updates  
- ✅ **Add relationships** → Junction tables automatically handled
- ✅ **Zero manual updates** → Everything happens automatically

**Your Twenty CRM integration becomes truly future-proof!** 🚀
