# Twenty CRM API Documentation

**Instance**: https://stratt-central.b2bcontentartist.com  
**Local API**: http://localhost:3000  
**Authentication**: Bearer token (stored in `/root/.nanobot/tools/twenty_crm.sh`)

## API Endpoints

- **REST API**: `http://localhost:3000/rest/`
- **GraphQL API**: `http://localhost:3000/graphql/`

## Important: JSON Payload Structure

Twenty CRM uses **nested objects** for most fields. This is the most common source of errors.

### ❌ WRONG (Flat structure)
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com"
}
```

### ✅ CORRECT (Nested structure)
```json
{
  "name": {
    "firstName": "John",
    "lastName": "Doe"
  },
  "emails": {
    "primaryEmail": "john@example.com"
  }
}
```

## People/Contacts API

### Create Contact

**Endpoint**: `POST /rest/people`

**Minimal Payload** (only required fields):
```json
{
  "name": {
    "firstName": "John",
    "lastName": "Doe"
  }
}
```

**Full Payload** (all available fields):
```json
{
  "name": {
    "firstName": "John",
    "lastName": "Doe"
  },
  "emails": {
    "primaryEmail": "john.doe@example.com",
    "additionalEmails": []
  },
  "phones": {
    "primaryPhoneNumber": "+1234567890",
    "primaryPhoneCountryCode": "US",
    "primaryPhoneCallingCode": "+1",
    "additionalPhones": []
  },
  "linkedinLink": {
    "primaryLinkUrl": "https://www.linkedin.com/in/johndoe/",
    "primaryLinkLabel": "LinkedIn",
    "secondaryLinks": []
  },
  "xLink": {
    "primaryLinkUrl": "https://x.com/johndoe",
    "primaryLinkLabel": "X",
    "secondaryLinks": []
  },
  "jobTitle": "CEO",
  "city": "San Francisco",
  "companyId": "uuid-of-company-if-linking"
}
```

**Example Command**:
```bash
bash /root/.nanobot/tools/twenty_crm.sh create-contact '{"name":{"firstName":"John","lastName":"Doe"},"emails":{"primaryEmail":"john@example.com"}}'
```

### Update Contact

**Endpoint**: `PATCH /rest/people/{id}`

**Payload** (only include fields to update):
```json
{
  "linkedinLink": {
    "primaryLinkUrl": "https://www.linkedin.com/in/johndoe/",
    "primaryLinkLabel": "LinkedIn"
  }
}
```

**Example Command**:
```bash
bash /root/.nanobot/tools/twenty_crm.sh update-contact <contact-id> '{"linkedinLink":{"primaryLinkUrl":"https://www.linkedin.com/in/johndoe/","primaryLinkLabel":"LinkedIn"}}'
```

### Search Contacts

**Endpoint**: `GET /rest/people?filter[name][ilike]=%{query}%`

**Example Command**:
```bash
bash /root/.nanobot/tools/twenty_crm.sh search-contacts "John"
```

### Get Contact

**Endpoint**: `GET /rest/people/{id}`

**Example Command**:
```bash
bash /root/.nanobot/tools/twenty_crm.sh get-contact <contact-id>
```

### List All Contacts

**Endpoint**: `GET /rest/people`

**Example Command**:
```bash
bash /root/.nanobot/tools/twenty_crm.sh list-contacts
```

### Delete Contact

**Endpoint**: `DELETE /rest/people/{id}`

**Example Command**:
```bash
bash /root/.nanobot/tools/twenty_crm.sh delete-contact <contact-id>
```

## Companies API

### Create Company

**Endpoint**: `POST /rest/companies`

**Minimal Payload**:
```json
{
  "name": "Acme Corp"
}
```

**Full Payload**:
```json
{
  "name": "Acme Corp",
  "domainName": {
    "primaryLinkUrl": "https://acme.com",
    "primaryLinkLabel": "Website"
  },
  "linkedinLink": {
    "primaryLinkUrl": "https://www.linkedin.com/company/acme/",
    "primaryLinkLabel": "LinkedIn"
  },
  "xLink": {
    "primaryLinkUrl": "https://x.com/acmecorp",
    "primaryLinkLabel": "X"
  },
  "address": {
    "addressStreet1": "123 Main St",
    "addressCity": "San Francisco",
    "addressState": "CA",
    "addressPostcode": "94102",
    "addressCountry": "USA"
  },
  "employees": 100,
  "idealCustomerProfile": true
}
```

**Example Command**:
```bash
bash /root/.nanobot/tools/twenty_crm.sh create-company '{"name":"Acme Corp","domainName":{"primaryLinkUrl":"https://acme.com"}}'
```

### Update Company

**Endpoint**: `PATCH /rest/companies/{id}`

**Example Command**:
```bash
bash /root/.nanobot/tools/twenty_crm.sh update-company <company-id> '{"employees":150}'
```

### Search Companies

**Example Command**:
```bash
bash /root/.nanobot/tools/twenty_crm.sh search-companies "Acme"
```

## Opportunities API

### Create Opportunity

**Endpoint**: `POST /rest/opportunities`

**Minimal Payload**:
```json
{
  "name": "Q1 Deal"
}
```

**Full Payload**:
```json
{
  "name": "Q1 Deal",
  "amount": {
    "amountMicros": 50000000000,
    "currencyCode": "USD"
  },
  "closeDate": "2026-03-31T00:00:00.000Z",
  "stage": "NEW",
  "probability": "50",
  "companyId": "uuid-of-company",
  "pointOfContactId": "uuid-of-contact"
}
```

**Stages**: NEW, SCREENING, MEETING, PROPOSAL, CUSTOMER, LOST

**Example Command**:
```bash
bash /root/.nanobot/tools/twenty_crm.sh create-opportunity '{"name":"Q1 Deal","amount":{"amountMicros":50000000000,"currencyCode":"USD"},"stage":"NEW"}'
```

## Tasks API

### Create Task

**Endpoint**: `POST /rest/tasks`

**Minimal Payload**:
```json
{
  "title": "Follow up with John"
}
```

**Full Payload**:
```json
{
  "title": "Follow up with John",
  "body": "Discuss Q1 proposal",
  "dueAt": "2026-03-20T10:00:00.000Z",
  "status": "TODO",
  "assigneeId": "uuid-of-workspace-member"
}
```

**Status values**: TODO, IN_PROGRESS, DONE

**Example Command**:
```bash
bash /root/.nanobot/tools/twenty_crm.sh create-task '{"title":"Follow up with John","status":"TODO"}'
```

## Notes API

### Create Note

**Endpoint**: `POST /rest/notes`

**IMPORTANT**: Notes use `bodyV2` for rich text content (not `body` or `content`).

**Minimal Payload (title only)**:
```json
{
  "title": "Meeting Notes"
}
```

**With Body Content (Rich Text)**:
```json
{
  "title": "Meeting Notes",
  "bodyV2": {
    "markdown": "Discussed partnership opportunities and next steps.\n\n- Action item 1\n- Action item 2"
  }
}
```

**With Position**:
```json
{
  "title": "Meeting Notes",
  "bodyV2": {
    "markdown": "Your note content here"
  },
  "position": 0
}
```

**Example Commands**:
```bash
# Simple note with title only
bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"Meeting Notes"}'

# Note with body content
bash /root/.nanobot/tools/twenty_crm.sh create-note '{"title":"Meeting Notes","bodyV2":{"markdown":"Discussed partnership opportunities"}}'
```

**Note**: The `bodyV2` field is a RichTextV2 object that accepts markdown. The system will automatically convert it to BlockNote format for rich text editing in the UI.

## Calendar Events API

### Create Calendar Event

**Endpoint**: `POST /rest/calendarEvents`

**Payload**:
```json
{
  "title": "Sales Call",
  "startsAt": "2026-03-20T14:00:00.000Z",
  "endsAt": "2026-03-20T15:00:00.000Z",
  "isFullDay": false,
  "conferenceLink": {
    "primaryLinkUrl": "https://meet.google.com/abc-defg-hij",
    "primaryLinkLabel": "Google Meet"
  }
}
```

**Example Command**:
```bash
bash /root/.nanobot/tools/twenty_crm.sh create-calendar-event '{"title":"Sales Call","startsAt":"2026-03-20T14:00:00.000Z","endsAt":"2026-03-20T15:00:00.000Z"}'
```

## Common Patterns

### Nested Object Fields

These fields use nested objects:
- `name` → `{firstName, lastName}`
- `emails` → `{primaryEmail, additionalEmails}`
- `phones` → `{primaryPhoneNumber, primaryPhoneCountryCode, additionalPhones}`
- `linkedinLink` → `{primaryLinkUrl, primaryLinkLabel, secondaryLinks}`
- `xLink` → `{primaryLinkUrl, primaryLinkLabel, secondaryLinks}`
- `domainName` → `{primaryLinkUrl, primaryLinkLabel}`
- `address` → `{addressStreet1, addressCity, addressState, addressPostcode, addressCountry}`
- `amount` → `{amountMicros, currencyCode}`
- `conferenceLink` → `{primaryLinkUrl, primaryLinkLabel}`

### Amount Fields

Amounts are stored in **micros** (1/1,000,000 of the currency unit):
- $50,000 = 50000000000 micros
- $100 = 100000000 micros

### Date Fields

Dates must be in **ISO 8601 format**:
- `2026-03-20T14:00:00.000Z`

### UUID Fields

When linking to other objects, use their UUID:
- `companyId`: UUID of the company
- `pointOfContactId`: UUID of the contact
- `assigneeId`: UUID of the workspace member

## Error Handling

### Common Errors

1. **"Object person doesn't have any 'firstName' field"**
   - **Cause**: Using flat structure instead of nested
   - **Fix**: Wrap in `name: {firstName, lastName}`

2. **BadRequestException**
   - **Cause**: Invalid JSON structure or missing required fields
   - **Fix**: Verify JSON syntax and required fields

3. **404 Not Found**
   - **Cause**: Invalid ID or object doesn't exist
   - **Fix**: Verify the ID exists using list or search commands

## Testing Commands

Test the API directly:
```bash
# List all contacts
curl -s http://localhost:3000/rest/people -H "Authorization: Bearer <token>"

# Create test contact
curl -s -X POST http://localhost:3000/rest/people \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":{"firstName":"Test","lastName":"User"}}'
```

## Best Practices

1. **Always use nested objects** for complex fields
2. **Start with minimal payloads** and add fields incrementally
3. **Verify IDs exist** before linking objects
4. **Use ISO 8601 dates** for all date/time fields
5. **Store amounts in micros** for currency fields
6. **Test with search** before creating duplicates
