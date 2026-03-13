# Twenty CRM Schema - Your Instance

**Generated from your Twenty CRM GraphQL schema**

This is the EXACT schema from your CRM instance. Use this as the definitive reference.

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

# 2. Create note (will appear in Mike H's timeline)
bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"Mike H - Initial Contact","bodyV2":{"markdown":"Met at conference.\n\nInterested in:\n- Partnership opportunities\n- Product demo"}}'

# 3. Create task (will appear in Mike H's timeline)
bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Follow up with Mike H","bodyV2":{"markdown":"Send proposal and schedule demo call"},"status":"TODO","dueAt":"2026-03-20T10:00:00.000Z"}'
```
