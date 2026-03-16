# Twenty CRM Schema - Your Instance

**Generated from your Twenty CRM GraphQL schema**

This is the EXACT schema from your CRM instance. Use this as the definitive reference.

## CRITICAL: Relationship Model

Twenty CRM uses **junction tables** to link notes and tasks to contacts. You CANNOT link them directly when creating.

### How to Link a Note to a Contact

**Step 1**: Create the note
```bash
NOTE_RESPONSE=$(bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"Meeting with Mike H","bodyV2":{"markdown":"Discussed partnership"}}')
NOTE_ID=$(echo $NOTE_RESPONSE | jq -r '.data.createNote.id')
```

**Step 2**: Create a NoteTarget to link it to the contact
```bash
bash /root/.nanobot/tools/twenty_crm.sh create-note-target '{"noteId":"'$NOTE_ID'","targetPersonId":"2e9a0129-98b2-412c-91cf-866b3739a60e"}'
```

### How to Link a Task to a Contact

**Step 1**: Create the task
```bash
TASK_RESPONSE=$(bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Follow up with Mike H","bodyV2":{"markdown":"Send proposal"}}')
TASK_ID=$(echo $TASK_RESPONSE | jq -r '.data.createTask.id')
```

**Step 2**: Create a TaskTarget to link it to the contact
```bash
bash /root/.nanobot/tools/twenty_crm.sh create-task-target '{"taskId":"'$TASK_ID'","targetPersonId":"2e9a0129-98b2-412c-91cf-866b3739a60e"}'
```

### Junction Table Operations

**NoteTarget** - Links notes to contacts/companies/opportunities/tasks/work items
```bash
# Link note to person
bash /root/.nanobot/tools/twenty_crm.sh create-note-target '{"noteId":"<note-id>","targetPersonId":"<person-id>"}'

# Link note to company
bash /root/.nanobot/tools/twenty_crm.sh create-note-target '{"noteId":"<note-id>","targetCompanyId":"<company-id>"}'

# Link note to opportunity
bash /root/.nanobot/tools/twenty_crm.sh create-note-target '{"noteId":"<note-id>","targetOpportunityId":"<opportunity-id>"}'

# Link note to task
bash /root/.nanobot/tools/twenty_crm.sh create-note-target '{"noteId":"<note-id>","targetTaskId":"<task-id>"}'

# Link note to work item
bash /root/.nanobot/tools/twenty_crm.sh create-note-target '{"noteId":"<note-id>","targetWorkItemId":"<work-item-id>"}'
```

**TaskTarget** - Links tasks to contacts/companies/opportunities
```bash
# Link task to person
bash /root/.nanobot/tools/twenty_crm.sh create-task-target '{"taskId":"<task-id>","targetPersonId":"<person-id>"}'

# Link task to company
bash /root/.nanobot/tools/twenty_crm.sh create-task-target '{"taskId":"<task-id>","targetCompanyId":"<company-id>"}'

# Link task to opportunity
bash /root/.nanobot/tools/twenty_crm.sh create-task-target '{"taskId":"<task-id>","targetOpportunityId":"<opportunity-id>"}'
```

### How to Link a Note to a Task

**Step 1**: Create the note
```bash
NOTE_RESPONSE=$(bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"Task Update","bodyV2":{"markdown":"Progress update on task"}}')
NOTE_ID=$(echo $NOTE_RESPONSE | jq -r '.data.createNote.id')
```

**Step 2**: Create a NoteTarget to link it to the task
```bash
bash /root/.nanobot/tools/twenty_crm.sh create-note-target '{"noteId":"'$NOTE_ID'","targetTaskId":"<task-id>"}'
```

### How to Link a Note to a Work Item

**Step 1**: Create the note
```bash
NOTE_RESPONSE=$(bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"Work Item Update","bodyV2":{"markdown":"Progress update on work item"}}')
NOTE_ID=$(echo $NOTE_RESPONSE | jq -r '.data.createNote.id')
```

**Step 2**: Create a NoteTarget to link it to the work item
```bash
bash /root/.nanobot/tools/twenty_crm.sh create-note-target '{"noteId":"'$NOTE_ID'","targetWorkItemId":"<work-item-id>"}'
```

## Person (Contact) Schema

### Writable Fields (for create/update)

```json
{
  "name": {
    "firstName": "string",
    "lastName": "string"
  },
  "emails": {
    "primaryEmail": "string",
    "additionalEmails": []
  },
  "linkedinLink": {
    "primaryLinkUrl": "string",
    "primaryLinkLabel": "string",
    "secondaryLinks": []
  },
  "xLink": {
    "primaryLinkUrl": "string",
    "primaryLinkLabel": "string",
    "secondaryLinks": []
  },
  "jobTitle": "string",
  "phones": {
    "primaryPhoneNumber": "string",
    "primaryPhoneCountryCode": "string",
    "primaryPhoneCallingCode": "string",
    "additionalPhones": []
  },
  "city": "string",
  "avatarUrl": "string",
  "companyId": "UUID"
}
```

### Working Example
```bash
bash /root/.nanobot/tools/twenty_crm.sh create-contact '{"name":{"firstName":"John","lastName":"Doe"},"emails":{"primaryEmail":"john@example.com"},"linkedinLink":{"primaryLinkUrl":"https://linkedin.com/in/johndoe","primaryLinkLabel":"LinkedIn"},"jobTitle":"CEO"}'
```

## Note Schema

### Writable Fields

```json
{
  "title": "string",
  "bodyV2": {
    "markdown": "string"
  },
  "position": 0
}
```

**CRITICAL**: 
- Field is `bodyV2` NOT `body` or `content`
- `bodyV2` is an object with `markdown` property
- `title` is required, `bodyV2` is optional

### Working Example
```bash
bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"Meeting Notes","bodyV2":{"markdown":"Discussed partnership.\n\nAction items:\n- Item 1\n- Item 2"}}'
```

## Task Schema

### Writable Fields

```json
{
  "title": "string",
  "bodyV2": {
    "markdown": "string"
  },
  "dueAt": "ISO 8601 date",
  "status": "TODO | IN_PROGRESS | DONE",
  "assigneeId": "UUID (workspace member, NOT contact)",
  "position": 0
}
```

## Work Item Schema

### Writable Fields

```json
{
  "title": "string",
  "bodyV2": {
    "markdown": "string"
  },
  "dueAt": "ISO 8601 date",
  "status": "TODO | IN_PROGRESS | DONE",
  "assigneeId": "UUID (workspace member, NOT contact)",
  "position": 0,
  "label": "string"
}
```

**Note**: Work Items are similar to Tasks but may have additional fields like `label` for categorization.

**CRITICAL**:
- Field is `bodyV2` NOT `body` or `content`
- `bodyV2` is an object with `markdown` property
- `assigneeId` must be a workspace member UUID, NOT a contact UUID
- `status` defaults to "TODO"

### Working Example
```bash
# Without assignee
bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Follow up with client","bodyV2":{"markdown":"Send proposal and pricing"},"status":"TODO","dueAt":"2026-03-20T10:00:00.000Z"}'

# With assignee (Govind Davis)
bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Review contract","assigneeId":"417cca57-450e-436b-8e3f-0cb610f3e63b"}'
```

## Company Schema

### Writable Fields

```json
{
  "name": "string",
  "domainName": {
    "primaryLinkUrl": "string",
    "primaryLinkLabel": "string",
    "secondaryLinks": []
  },
  "linkedinLink": {
    "primaryLinkUrl": "string",
    "primaryLinkLabel": "string",
    "secondaryLinks": []
  },
  "xLink": {
    "primaryLinkUrl": "string",
    "primaryLinkLabel": "string",
    "secondaryLinks": []
  },
  "address": {
    "addressStreet1": "string",
    "addressStreet2": "string",
    "addressCity": "string",
    "addressState": "string",
    "addressPostcode": "string",
    "addressCountry": "string",
    "addressLat": 0,
    "addressLng": 0
  },
  "employees": 0,
  "annualRecurringRevenue": {
    "amountMicros": 0,
    "currencyCode": "USD"
  },
  "idealCustomerProfile": false,
  "accountOwnerId": "UUID (workspace member)"
}
```

### Working Example
```bash
bash /root/.nanobot/tools/twenty_crm.sh create-company '{"name":"Acme Corp","domainName":{"primaryLinkUrl":"https://acme.com","primaryLinkLabel":"Website"},"linkedinLink":{"primaryLinkUrl":"https://linkedin.com/company/acme","primaryLinkLabel":"LinkedIn"},"employees":100}'
```

## Opportunity Schema

### Writable Fields

```json
{
  "name": "string",
  "amount": {
    "amountMicros": 0,
    "currencyCode": "USD"
  },
  "closeDate": "ISO 8601 date",
  "stage": "NEW | SCREENING | MEETING | PROPOSAL | CUSTOMER | LOST",
  "probability": "string",
  "companyId": "UUID",
  "pointOfContactId": "UUID (person/contact)"
}
```

**Amount in Micros**:
- $100 = 100000000 micros
- $50,000 = 50000000000 micros

### Working Example
```bash
bash /root/.nanobot/tools/twenty_crm.sh create-opportunity '{"name":"Q1 Deal","amount":{"amountMicros":50000000000,"currencyCode":"USD"},"stage":"NEW","closeDate":"2026-03-31T00:00:00.000Z"}'
```

## Workspace Members

**Current Members**:
- Govind Davis: `417cca57-450e-436b-8e3f-0cb610f3e63b`

Use this ID for `assigneeId` in tasks or `accountOwnerId` in companies.

## Key Differences from Public API Docs

1. **bodyV2 NOT body**: Notes and tasks use `bodyV2` with `markdown` property
2. **Nested objects required**: All complex fields (name, emails, phones, links, address, amount) must be objects
3. **Contact IDs ≠ Assignee IDs**: Tasks can only be assigned to workspace members
4. **No direct linking**: Tasks/notes don't link to contacts when created, they appear in timeline automatically

## Common Errors and Fixes

### "Object doesn't have 'body' field"
**Fix**: Use `bodyV2` with `markdown` property
```json
{"bodyV2": {"markdown": "content"}}
```

### "Object doesn't have 'firstName' field"
**Fix**: Wrap in `name` object
```json
{"name": {"firstName": "John", "lastName": "Doe"}}
```

### "InternalServerErrorException" when creating task with assigneeId
**Fix**: Don't use contact ID as assignee ID. Either:
1. Omit `assigneeId` completely
2. Use workspace member ID: `417cca57-450e-436b-8e3f-0cb610f3e63b`

### "Data validation error"
**Causes**:
- Invalid UUID format
- Using contact ID where workspace member ID expected
- Missing required nested object structure

## Testing Commands

```bash
# Test contact creation
bash /root/.nanobot/tools/twenty_crm.sh create-contact '{"name":{"firstName":"Test","lastName":"User"}}'

# Test note creation
bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"Test Note","bodyV2":{"markdown":"Test content"}}'

# Test task creation
bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Test Task","bodyV2":{"markdown":"Test description"}}'

# Test company creation
bash /root/.nanobot/tools/twenty_crm.sh create-company '{"name":"Test Company"}'

# Test opportunity creation
bash /root/.nanobot/tools/twenty_crm.sh create-opportunity '{"name":"Test Deal"}'
```

## Complete Working Workflow

```bash
# 1. Create contact
CONTACT_RESPONSE=$(bash /root/.nanobot/tools/twenty_crm.sh create-contact '{"name":{"firstName":"Mike","lastName":"H"},"linkedinLink":{"primaryLinkUrl":"https://linkedin.com/in/micahgtm","primaryLinkLabel":"LinkedIn"},"jobTitle":"GTM Strategy"}')
CONTACT_ID=$(echo $CONTACT_RESPONSE | jq -r '.data.createPerson.id')

# 2. Create note
NOTE_RESPONSE=$(bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"Mike H - Initial Contact","bodyV2":{"markdown":"Met at conference.\n\nInterested in:\n- Partnership opportunities\n- Product demo"}}')
NOTE_ID=$(echo $NOTE_RESPONSE | jq -r '.data.createNote.id')

# 3. Link note to contact
bash /root/.nanobot/tools/twenty_crm.sh create-note-target "{\"noteId\":\"$NOTE_ID\",\"targetPersonId\":\"$CONTACT_ID\"}"

# 4. Create task
TASK_RESPONSE=$(bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Follow up with Mike H","bodyV2":{"markdown":"Send proposal and schedule demo call"},"status":"TODO","dueAt":"2026-03-20T10:00:00.000Z"}')
TASK_ID=$(echo $TASK_RESPONSE | jq -r '.data.createTask.id')

# 5. Link task to contact
bash /root/.nanobot/tools/twenty_crm.sh create-task-target "{\"taskId\":\"$TASK_ID\",\"targetPersonId\":\"$CONTACT_ID\"}"
```

### Simplified Workflow (if contact already exists)

```bash
# Mike H's contact ID
MIKE_ID="2e9a0129-98b2-412c-91cf-866b3739a60e"

# Create and link note
NOTE_ID=$(bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"LinkedIn Message 1","bodyV2":{"markdown":"Mike, build this and your life will never be the same."}}' | jq -r '.data.createNote.id')
bash /root/.nanobot/tools/twenty_crm.sh create-note-target "{\"noteId\":\"$NOTE_ID\",\"targetPersonId\":\"$MIKE_ID\"}"

# Create and link task
TASK_ID=$(bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Follow up on LinkedIn message","status":"TODO"}' | jq -r '.data.createTask.id')
bash /root/.nanobot/tools/twenty_crm.sh create-task-target "{\"taskId\":\"$TASK_ID\",\"targetPersonId\":\"$MIKE_ID\"}"
```
