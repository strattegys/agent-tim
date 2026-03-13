# LinkedIn Message Integration for Tim

## Overview

Automated system to fetch LinkedIn messages via ConnectSafely API, create/update contacts in Twenty CRM, and alert GMoney about new messages.

## Components

### 1. LinkedIn Message Extractor Script
**File**: `/root/.nanobot/tools/linkedin_message_extractor.sh`

**Features**:
- Fetches recent LinkedIn messages via ConnectSafely API
- Creates or updates contacts in Twenty CRM
- Links messages to contacts via NoteTarget junction table
- Sends alerts to GMoney via Telegram
- Maintains state with cursor for incremental processing

### 2. Alert System
**Methods**:
- **Telegram**: Direct message to GMoney (chat_id: 5289013326)
- **Log File**: `/root/.nanobot/linkedin_alerts.log`
- **Console**: Real-time output

### 3. Automation Setup
**Cron Job**: Run every 15 minutes
```bash
# Edit crontab
crontab -e

# Add this line:
*/15 * * * * /root/.nanobot/tools/linkedin_message_extractor.sh >/dev/null 2>&1
```

## Installation

### Step 1: Deploy Script
```bash
# Copy script to droplet
scp linkedin_message_extractor.sh root@137.184.187.233:/root/.nanobot/tools/

# Make executable
ssh root@137.184.187.233 "chmod +x /root/.nanobot/tools/linkedin_message_extractor.sh"
```

### Step 2: Test Script
```bash
# Test with message limit
ssh root@137.184.187.233 "/root/.nanobot/tools/linkedin_message_extractor.sh 5"

# Check alerts log
ssh root@137.184.187.233 "tail -f /root/.nanobot/linkedin_alerts.log"
```

### Step 3: Set Up Automation
```bash
# Create cron job
ssh root@137.184.187.233 "(crontab -l 2>/dev/null; echo '*/15 * * * * /root/.nanobot/tools/linkedin_message_extractor.sh >/dev/null 2>&1') | crontab -"
```

## Configuration

### ConnectSafely API
- **API Key**: `1df1fdda-51e5-46c1-8a97-99dde05a11d1`
- **Account ID**: `699fbf3eb09b5425c73d4b81`
- **Base URL**: `https://api.connectsafely.ai`

### Twenty CRM Integration
- Uses existing `/root/.nanobot/tools/twenty_crm.sh`
- Creates contacts with LinkedIn profiles
- Links messages via NoteTarget junction table
- Follows correct schema: `bodyV2` with `markdown`

### Alert Configuration
- **Telegram Token**: From `/root/.nanobot/config.json`
- **GMoney Chat ID**: `5289013326`
- **Alert Log**: `/root/.nanobot/linkedin_alerts.log`

## Workflow

### 1. Message Fetching
```bash
GET https://api.connectsafely.ai/linkedin/messaging/recent-messages
Headers:
  Authorization: Bearer {API_KEY}
  Content-Type: application/json
```

### 2. Contact Processing
```bash
# Search for existing contact
SEARCH_RESPONSE=$(twenty_crm.sh search-contacts "$SENDER_NAME")

# Create if not found
CREATE_PAYLOAD='{"name":{"firstName":"John","lastName":"Doe"},"linkedinLink":{"primaryLinkUrl":"https://linkedin.com/in/johndoe","primaryLinkLabel":"LinkedIn"}}'
CREATE_RESPONSE=$(twenty_crm.sh create-contact "$CREATE_PAYLOAD")
```

### 3. Message Storage
```bash
# Create note
NOTE_PAYLOAD='{"title":"LinkedIn Message from John Doe","bodyV2":{"markdown":"**From:** John Doe\\n**Date:** 2026-03-13 15:30:00\\n\\n**Message:**\\nHi there!"}}'
NOTE_RESPONSE=$(twenty_crm.sh create-note "$NOTE_PAYLOAD")

# Link to contact
TARGET_PAYLOAD='{"noteId":"NOTE_ID","targetPersonId":"CONTACT_ID"}'
TARGET_RESPONSE=$(twenty_crm.sh create-note-target "$TARGET_PAYLOAD")
```

### 4. Alert Sending
```bash
# Telegram alert
curl -X POST "https://api.telegram.org/bot{TOKEN}/sendMessage" \
  -d chat_id="5289013326" \
  -d text="🔔 LinkedIn Alert: New message from John Doe: Hi there!"
```

## Key Fixes Applied

### 1. Twenty CRM Schema Issues
- **Fixed**: Use `.data.createPerson.id` instead of `.id`
- **Fixed**: Create NoteTarget to link notes to contacts
- **Fixed**: Use `bodyV2` with `markdown` structure

### 2. Contact Creation
- **Fixed**: Include LinkedIn profile in initial contact creation
- **Fixed**: Proper JSON escaping for special characters
- **Fixed**: Handle single-word names gracefully

### 3. Error Handling
- **Added**: API response validation
- **Added**: Contact ID validation
- **Added**: Alert on failures

### 4. State Management
- **Fixed**: Proper cursor handling for incremental processing
- **Fixed**: JSON state file creation and reading

## Testing

### Manual Test
```bash
# Test with 5 messages
ssh root@137.184.187.233 "/root/.nanobot/tools/linkedin_message_extractor.sh 5"

# Check results
ssh root@137.184.187.233 "tail -20 /root/.nanobot/linkedin_alerts.log"
```

### Integration Test
```bash
# Verify Twenty CRM integration
ssh root@137.184.187.233 "bash /root/.nanobot/tools/twenty_crm.sh search-contacts 'LinkedIn' | jq '.[] | {id, name, linkedinLink}'"

# Check recent notes
ssh root@137.184.187.233 "bash /root/.nanobot/tools/twenty_crm.sh list-notes | jq '.[] | {id, title, createdAt}'"
```

## Monitoring

### Logs to Monitor
1. **Script Output**: Console during manual runs
2. **Alert Log**: `/root/.nanobot/linkedin_alerts.log`
3. **Cron Log**: `/var/log/cron.log` (if enabled)
4. **Nanobot Logs**: `journalctl -u nanobot -f`

### Key Metrics
- Messages processed per run
- Contacts created vs found
- Note creation success rate
- Alert delivery success

## Troubleshooting

### Common Issues

1. **API Key Invalid**
   - Check ConnectSafely API key
   - Verify account ID

2. **Twenty CRM Errors**
   - Verify CRM is accessible
   - Check API token in twenty_crm.sh

3. **Telegram Alerts Not Working**
   - Check bot token in config.json
   - Verify chat_id: 5289013326

4. **Cron Job Not Running**
   - Check crontab with `crontab -l`
   - Verify script permissions

### Debug Commands
```bash
# Check script permissions
ssh root@137.184.187.233 "ls -la /root/.nanobot/tools/linkedin_message_extractor.sh"

# Test API connectivity
ssh root@137.184.187.233 "curl -s 'https://api.connectsafely.ai/linkedin/messaging/recent-messages' -H 'Authorization: Bearer 1df1fdda-51e5-46c1-8a97-99dde05a11d1' | jq ."

# Check Twenty CRM connectivity
ssh root@137.184.187.233 "bash /root/.nanobot/tools/twenty_crm.sh list-contacts | jq '. | length'"
```

## Future Enhancements

1. **Message Response**: Auto-respond to common messages
2. **Sentiment Analysis**: Flag urgent or negative messages
3. **Contact Enrichment**: Auto-fill contact details from LinkedIn
4. **Dashboard**: Web interface for monitoring
5. **Integration**: Connect to other CRM systems

## Security Considerations

1. **API Keys**: Stored in script, consider environment variables
2. **Data Privacy**: Messages stored in Twenty CRM
3. **Access Control**: Limit script execution permissions
4. **Logging**: Avoid logging sensitive message content
