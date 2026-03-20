#!/usr/bin/env python3
"""
Adds campaign commands to twenty_crm_enhanced.sh.
Inserts them before the error handler (the *) case).
Also updates the error message to include get-campaign-spec and update-campaign-spec.
"""

SCRIPT_PATH = "/root/.nanobot/tools/twenty_crm_enhanced.sh"

CAMPAIGN_BLOCK = r'''
    # ==================== CAMPAIGN COMMANDS ====================

    list-campaigns)
        RESPONSE=$(api_call GET "/rest/campaigns?limit=50")
        echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
campaigns = data.get('data', {}).get('campaigns', [])
if not campaigns:
    print('No campaigns found.')
    sys.exit(0)
print(f'Found {len(campaigns)} campaign(s):')
print()
for c in campaigns:
    stage = c.get('stage', '?')
    print(f\"ID: {c['id']}\")
    print(f\"  Name: {c.get('name', '?')}\")
    print(f\"  Stage: {stage}\")
    spec = c.get('spec', '')
    if spec:
        preview = spec[:100] + '...' if len(spec) > 100 else spec
        print(f\"  Spec preview: {preview}\")
    print()
"
        ;;

    get-campaign)
        if [ -z "$2" ]; then echo "Usage: get-campaign <campaign_id>"; exit 1; fi
        RESPONSE=$(api_call GET "/rest/campaigns/$2")
        echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
c = data.get('data', {}).get('campaign', {})
if not c:
    print('Campaign not found.')
    sys.exit(1)
print(f\"Campaign: {c.get('name', '?')}\")
print(f\"ID: {c['id']}\")
print(f\"Stage: {c.get('stage', '?')}\")
print(f\"Created: {c.get('createdAt', '?')}\")
print(f\"Updated: {c.get('updatedAt', '?')}\")
print()
spec = c.get('spec', '')
if spec:
    print('=== SPEC ===')
    print(spec)
    print('=== END SPEC ===')
else:
    print('(No spec set)')
"
        ;;

    get-campaign-spec)
        if [ -z "$2" ]; then echo "Usage: get-campaign-spec <campaign_id>"; exit 1; fi
        RESPONSE=$(api_call GET "/rest/campaigns/$2")
        echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
c = data.get('data', {}).get('campaign', {})
if not c:
    print('Campaign not found.')
    sys.exit(1)
print(f\"Campaign: {c.get('name', '?')}\")
print()
spec = c.get('spec', '')
if spec:
    print(spec)
else:
    print('(No spec set)')
"
        ;;

    update-campaign-spec)
        if [ -z "$2" ] || [ -z "$3" ]; then
            echo "Usage: update-campaign-spec <campaign_id> <new_spec_content>"
            exit 1
        fi
        CAMPAIGN_ID="$2"
        NEW_SPEC="$3"
        PAYLOAD=$(python3 -c "import json,sys; print(json.dumps({'spec': sys.argv[1]}))" "$NEW_SPEC")
        RESPONSE=$(api_call PATCH "/rest/campaigns/$CAMPAIGN_ID" "$PAYLOAD")
        echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
c = data.get('data', {}).get('updateCampaign', {})
if c and c.get('id'):
    print(f\"Campaign spec updated successfully.\")
    print(f\"Campaign: {c.get('name', '?')}\")
else:
    print('Failed to update campaign spec.')
    print(json.dumps(data, indent=2))
    sys.exit(1)
"
        ;;

    create-campaign)
        if [ -z "$2" ]; then
            echo "Usage: create-campaign <name> [spec]"
            exit 1
        fi
        CAMP_NAME="$2"
        CAMP_SPEC="${3:-}"
        PAYLOAD=$(python3 -c "
import json, sys
data = {'name': sys.argv[1], 'stage': 'PLANNING'}
if len(sys.argv) > 2 and sys.argv[2]:
    data['spec'] = sys.argv[2]
print(json.dumps(data))
" "$CAMP_NAME" "$CAMP_SPEC")
        RESPONSE=$(api_call POST "/rest/campaigns" "$PAYLOAD")
        echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
c = data.get('data', {}).get('createCampaign', {})
if c and c.get('id'):
    print(f\"Campaign created successfully!\")
    print(f\"ID: {c['id']}\")
    print(f\"Name: {c.get('name', '?')}\")
    print(f\"Stage: {c.get('stage', '?')}\")
else:
    print('Failed to create campaign.')
    print(json.dumps(data, indent=2))
    sys.exit(1)
"
        ;;

    add-to-campaign)
        if [ -z "$2" ] || [ -z "$3" ]; then
            echo "Usage: add-to-campaign <person_id> <campaign_id>"
            exit 1
        fi
        PERSON_ID="$2"
        CAMPAIGN_ID="$3"
        PAYLOAD=$(python3 -c "import json,sys; print(json.dumps({'activeCampaignId': sys.argv[1]}))" "$CAMPAIGN_ID")
        RESPONSE=$(api_call PATCH "/rest/people/$PERSON_ID" "$PAYLOAD")
        echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
p = data.get('data', {}).get('updatePerson', {})
if p and p.get('id'):
    name = p.get('name', {})
    fn = name.get('firstName', '') if isinstance(name, dict) else ''
    ln = name.get('lastName', '') if isinstance(name, dict) else ''
    print(f\"Added {fn} {ln} to campaign.\")
    print(f\"activeCampaignId: {p.get('activeCampaignId', '?')}\")
else:
    print('Failed to add person to campaign.')
    print(json.dumps(data, indent=2))
    sys.exit(1)
"
        ;;

    remove-from-campaign)
        if [ -z "$2" ]; then
            echo "Usage: remove-from-campaign <person_id>"
            exit 1
        fi
        PERSON_ID="$2"
        PAYLOAD='{"activeCampaignId": null}'
        RESPONSE=$(api_call PATCH "/rest/people/$PERSON_ID" "$PAYLOAD")
        echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
p = data.get('data', {}).get('updatePerson', {})
if p and p.get('id'):
    name = p.get('name', {})
    fn = name.get('firstName', '') if isinstance(name, dict) else ''
    ln = name.get('lastName', '') if isinstance(name, dict) else ''
    print(f\"Removed {fn} {ln} from campaign.\")
else:
    print('Failed to remove person from campaign.')
    print(json.dumps(data, indent=2))
    sys.exit(1)
"
        ;;

    get-campaign-context)
        if [ -z "$2" ]; then
            echo "Usage: get-campaign-context <person_id>"
            exit 1
        fi
        PERSON_ID="$2"
        PERSON_RESP=$(api_call GET "/rest/people/$PERSON_ID")
        CAMPAIGN_ID=$(echo "$PERSON_RESP" | python3 -c "
import json, sys
data = json.load(sys.stdin)
p = data.get('data', {}).get('person', {})
cid = p.get('activeCampaignId')
if cid:
    print(cid)
else:
    print('NO_CAMPAIGNS')
" 2>/dev/null)

        if [ "$CAMPAIGN_ID" = "NO_CAMPAIGNS" ] || [ -z "$CAMPAIGN_ID" ]; then
            echo "NO_CAMPAIGNS"
            exit 0
        fi

        CAMP_RESP=$(api_call GET "/rest/campaigns/$CAMPAIGN_ID")
        echo "$CAMP_RESP" | python3 -c "
import json, sys
data = json.load(sys.stdin)
c = data.get('data', {}).get('campaign', {})
if not c:
    print('Campaign not found (ID may be stale).')
    sys.exit(0)
print(f\"Campaign: {c.get('name', '?')}\")
print(f\"ID: {c['id']}\")
print(f\"Stage: {c.get('stage', '?')}\")
print()
spec = c.get('spec', '')
if spec:
    print('=== CAMPAIGN SPEC ===')
    print(spec)
    print('=== END SPEC ===')
else:
    print('(No spec set for this campaign)')
"
        ;;

    list-campaign-members)
        if [ -z "$2" ]; then
            echo "Usage: list-campaign-members <campaign_id>"
            exit 1
        fi
        CAMPAIGN_ID="$2"
        RESPONSE=$(api_call GET "/rest/people?filter=activeCampaignId[eq]:$CAMPAIGN_ID&limit=50")
        echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
people = data.get('data', {}).get('people', [])
if not people:
    print('0 members in this campaign.')
    sys.exit(0)
print(f'{len(people)} member(s):')
print()
for p in people:
    name = p.get('name', {})
    fn = name.get('firstName', '') if isinstance(name, dict) else ''
    ln = name.get('lastName', '') if isinstance(name, dict) else ''
    title = p.get('jobTitle', '')
    print(f\"  {fn} {ln} (ID: {p['id'][:8]}...)\")
    if title:
        print(f\"    Title: {title}\")
    print()
"
        ;;
'''

NEW_ERROR_MSG = 'list-contacts, search-contacts, get-contact, create-contact, update-contact, delete-contact, list-companies, search-companies, get-company, create-company, update-company, delete-company, list-campaigns, get-campaign, get-campaign-spec, update-campaign-spec, create-campaign, add-to-campaign, remove-from-campaign, get-campaign-context, list-campaign-members, write-note'

def main():
    with open(SCRIPT_PATH, 'r') as f:
        content = f.read()

    # Find the LAST "# HELP" comment followed by "*)" — that's the main error handler
    lines = content.split('\n')
    insert_idx = None
    error_line_idx = None

    # Search backwards from the end for "# HELP" to find the main case error handler
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].strip() == '# HELP':
            insert_idx = i
            break

    if insert_idx is None:
        print("ERROR: Could not find error handler in script")
        return

    # Find the ERROR line to update
    for i, line in enumerate(lines):
        if 'ERROR: Unknown command' in line:
            error_line_idx = i
            break

    # Insert campaign block before error handler
    new_lines = lines[:insert_idx] + CAMPAIGN_BLOCK.split('\n') + lines[insert_idx:]

    # Update error message (find it again since line numbers shifted)
    for i, line in enumerate(new_lines):
        if 'ERROR: Unknown command' in line:
            new_lines[i] = f'        echo "ERROR: Unknown command \'$1\'. Available commands: {NEW_ERROR_MSG}"'
            break

    with open(SCRIPT_PATH, 'w') as f:
        f.write('\n'.join(new_lines))

    print(f"SUCCESS: Inserted campaign commands at line {insert_idx}")
    print(f"Total lines: {len(new_lines)}")

if __name__ == '__main__':
    main()
