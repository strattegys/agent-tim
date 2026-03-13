# Twenty CRM Quick Reference Guide

**For Tim: Use this as your primary reference for CRM operations**

## Critical Rules

1. **ALWAYS use `bodyV2` with `markdown` property** - Never use `body` or `content`
2. **Use nested objects** for complex fields (name, emails, phones, etc.)
3. **Contact IDs ≠ Assignee IDs** - Contacts are people in CRM, assignees are workspace members
4. **Tasks/Notes DON'T link directly to contacts** - Create them separately, they show up in contact timeline
5. **Test minimal payloads first** - Start with required fields only

## CRITICAL: Linking Tasks/Notes to Contacts

**IMPORTANT**: Tasks and notes are NOT directly linked to contacts when created. They appear in the contact's timeline automatically based on context.

**❌ WRONG - This will fail:**
```bash
# Contact ID is NOT an assignee ID
bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Task","assigneeId":"2e9a0129-98b2-412c-91cf-866b3739a60e"}'
```

**✅ CORRECT - Create task without assignee:**
```bash
# Task will appear in timeline, no direct linking needed
bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Follow up with Mike H","bodyV2":{"markdown":"Discussed partnership"}}'
```

**✅ CORRECT - Assign to workspace member (if needed):**
```bash
# Use workspace member ID (from list-workspace-members)
bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Task","assigneeId":"417cca57-450e-436b-8e3f-0cb610f3e63b"}'
```

**Workspace Member ID**: `417cca57-450e-436b-8e3f-0cb610f3e63b` (Govind Davis)

## Contact Operations

### Create Contact
```bash
# Minimal (required only)
bash /root/.nanobot/tools/twenty_crm.sh create-contact '{"name":{"firstName":"John","lastName":"Doe"}}'

# With email
bash /root/.nanobot/tools/twenty_crm.sh create-contact '{"name":{"firstName":"John","lastName":"Doe"},"emails":{"primaryEmail":"john@example.com"}}'

# With LinkedIn
bash /root/.nanobot/tools/twenty_crm.sh create-contact '{"name":{"firstName":"John","lastName":"Doe"},"linkedinLink":{"primaryLinkUrl":"https://linkedin.com/in/johndoe","primaryLinkLabel":"LinkedIn"}}'

# Full example
bash /root/.nanobot/tools/twenty_crm.sh create-contact '{"name":{"firstName":"John","lastName":"Doe"},"emails":{"primaryEmail":"john@example.com"},"linkedinLink":{"primaryLinkUrl":"https://linkedin.com/in/johndoe","primaryLinkLabel":"LinkedIn"},"jobTitle":"CEO"}'
```

### Update Contact
```bash
# Add LinkedIn URL
bash /root/.nanobot/tools/twenty_crm.sh update-contact <contact-id> '{"linkedinLink":{"primaryLinkUrl":"https://linkedin.com/in/johndoe","primaryLinkLabel":"LinkedIn"}}'

# Update job title
bash /root/.nanobot/tools/twenty_crm.sh update-contact <contact-id> '{"jobTitle":"Senior Developer"}'
```

### Search Contact
```bash
bash /root/.nanobot/tools/twenty_crm.sh search-contacts "John"
```

## Note Operations

### Create Note
```bash
# Title only
bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"Meeting Notes"}'

# With body content (CORRECT - use bodyV2)
bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"Meeting Notes","bodyV2":{"markdown":"Discussed partnership opportunities.\n\nAction items:\n- Send proposal\n- Schedule demo"}}'

# ❌ WRONG - Don't use these
# bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"Note","body":"Content"}'  # NO
# bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"Note","content":"Content"}'  # NO
```

## Task Operations

### Create Task
```bash
# Minimal (title only)
bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Follow up with John"}'

# With body content (CORRECT - use bodyV2)
bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Follow up with John","bodyV2":{"markdown":"Discuss Q1 proposal and pricing"}}'

# With status
bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Follow up with John","status":"TODO"}'

# With due date
bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Follow up with John","dueAt":"2026-03-20T10:00:00.000Z"}'

# ❌ WRONG - Don't use these
# bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Task","body":"Description"}'  # NO
# bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Task","assigneeId":"<contact-id>"}'  # Contact IDs are NOT assignee IDs
```

**Task Status Values**: `TODO`, `IN_PROGRESS`, `DONE`

## Company Operations

### Create Company
```bash
# Minimal
bash /root/.nanobot/tools/twenty_crm.sh create-company '{"name":"Acme Corp"}'

# With website
bash /root/.nanobot/tools/twenty_crm.sh create-company '{"name":"Acme Corp","domainName":{"primaryLinkUrl":"https://acme.com","primaryLinkLabel":"Website"}}'

# With LinkedIn
bash /root/.nanobot/tools/twenty_crm.sh create-company '{"name":"Acme Corp","linkedinLink":{"primaryLinkUrl":"https://linkedin.com/company/acme","primaryLinkLabel":"LinkedIn"}}'
```

## Opportunity Operations

### Create Opportunity
```bash
# Minimal
bash /root/.nanobot/tools/twenty_crm.sh create-opportunity '{"name":"Q1 Deal"}'

# With amount (in micros: $50,000 = 50000000000)
bash /root/.nanobot/tools/twenty_crm.sh create-opportunity '{"name":"Q1 Deal","amount":{"amountMicros":50000000000,"currencyCode":"USD"}}'

# With stage
bash /root/.nanobot/tools/twenty_crm.sh create-opportunity '{"name":"Q1 Deal","stage":"NEW"}'
```

**Opportunity Stages**: `NEW`, `SCREENING`, `MEETING`, `PROPOSAL`, `CUSTOMER`, `LOST`

## Common Patterns

### Nested Object Fields

Always use nested objects for these fields:

```json
{
  "name": {"firstName": "John", "lastName": "Doe"},
  "emails": {"primaryEmail": "john@example.com"},
  "phones": {"primaryPhoneNumber": "+1234567890"},
  "linkedinLink": {"primaryLinkUrl": "https://linkedin.com/in/johndoe", "primaryLinkLabel": "LinkedIn"},
  "xLink": {"primaryLinkUrl": "https://x.com/johndoe", "primaryLinkLabel": "X"},
  "domainName": {"primaryLinkUrl": "https://example.com", "primaryLinkLabel": "Website"},
  "bodyV2": {"markdown": "Your content here"}
}
```

### Rich Text Content

For notes and tasks, ALWAYS use `bodyV2` with `markdown`:

```json
{
  "title": "Title here",
  "bodyV2": {
    "markdown": "Your content here.\n\nSupports:\n- Bullet points\n- **Bold**\n- *Italic*"
  }
}
```

### Date Format

Always use ISO 8601 format:
```
"2026-03-20T14:00:00.000Z"
```

### Amount Format

Amounts are in micros (1/1,000,000 of currency):
- $100 = 100000000 micros
- $50,000 = 50000000000 micros

## Troubleshooting

### "Object doesn't have 'body' field"
**Fix**: Use `bodyV2` with `markdown` property

### "Object doesn't have 'firstName' field"
**Fix**: Wrap in `name` object: `{"name":{"firstName":"...","lastName":"..."}}`

### "InternalServerErrorException"
**Causes**:
- Invalid UUID for linking (e.g., using contact ID as assignee ID)
- Required field missing
- Invalid field value

**Fix**: Start with minimal payload, verify IDs exist

### "BadRequestException"
**Causes**:
- Wrong JSON structure
- Invalid field name
- Missing required nested object

**Fix**: Check this quick reference for correct structure

## Workflow Examples

### Add Contact with LinkedIn
```bash
# 1. Create contact
bash /root/.nanobot/tools/twenty_crm.sh create-contact '{"name":{"firstName":"Mike","lastName":"H"},"linkedinLink":{"primaryLinkUrl":"https://linkedin.com/in/micahgtm","primaryLinkLabel":"LinkedIn"},"jobTitle":"GTM Strategy"}'

# 2. Get the contact ID from response
# 3. Create note for the contact
bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"Mike H - Initial Contact","bodyV2":{"markdown":"Met at conference. Interested in partnership."}}'
```

### Create Task for Follow-up
```bash
# Create task with description
bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Follow up with Mike H","bodyV2":{"markdown":"Send proposal and schedule demo"},"status":"TODO","dueAt":"2026-03-20T10:00:00.000Z"}'
```

## Field Reference

### Contact Fields
- `name` (object): `{firstName, lastName}` - **Required**
- `emails` (object): `{primaryEmail, additionalEmails}`
- `phones` (object): `{primaryPhoneNumber, primaryPhoneCountryCode}`
- `linkedinLink` (object): `{primaryLinkUrl, primaryLinkLabel}`
- `xLink` (object): `{primaryLinkUrl, primaryLinkLabel}`
- `jobTitle` (string)
- `city` (string)
- `companyId` (UUID)

### Note Fields
- `title` (string) - **Required**
- `bodyV2` (object): `{markdown}` - Optional
- `position` (number) - Optional

### Task Fields
- `title` (string) - **Required**
- `bodyV2` (object): `{markdown}` - Optional
- `status` (enum): `TODO`, `IN_PROGRESS`, `DONE` - Default: `TODO`
- `dueAt` (ISO 8601 date) - Optional
- `assigneeId` (UUID of workspace member, NOT contact) - Optional
- `position` (number) - Optional

### Company Fields
- `name` (string) - **Required**
- `domainName` (object): `{primaryLinkUrl, primaryLinkLabel}`
- `linkedinLink` (object): `{primaryLinkUrl, primaryLinkLabel}`
- `address` (object): `{addressStreet1, addressCity, addressState, addressPostcode, addressCountry}`
- `employees` (number)

### Opportunity Fields
- `name` (string) - **Required**
- `amount` (object): `{amountMicros, currencyCode}`
- `closeDate` (ISO 8601 date)
- `stage` (enum): `NEW`, `SCREENING`, `MEETING`, `PROPOSAL`, `CUSTOMER`, `LOST`
- `probability` (string)
- `companyId` (UUID)
- `pointOfContactId` (UUID of contact)
