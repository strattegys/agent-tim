#!/usr/bin/env python3
"""Adds campaign commands to twenty_crm_enhanced.sh"""

CAMPAIGN_COMMANDS = '''
    # ============================================================
    # CAMPAIGN MANAGEMENT
    # ============================================================

    create-campaign)
        CAM_NAME="${2:-}"
        CAM_BRIEF="${3:-}"
        if [ -z "$CAM_NAME" ]; then
            echo "Usage: create-campaign <name> <brief>"
            exit 1
        fi
        PAYLOAD=$(python3 -c "import json,sys; print(json.dumps({'name': sys.argv[1], 'itemType': 'CAMPAIGN', 'stage': 'NOW'}))" "$CAM_NAME")
        RESP=$(api_call POST "/rest/workItems" "$PAYLOAD")
        CAM_ID=$(echo "$RESP" | jq -r '.data.createWorkItem.id // empty')
        if [ -n "$CAM_ID" ] && [ "$CAM_ID" != "null" ]; then
            echo "Campaign created: $CAM_NAME"
            echo "ID: $CAM_ID"
            if [ -n "$CAM_BRIEF" ]; then
                _ntmp=$(mktemp)
                printf '%s' "$CAM_BRIEF" > "$_ntmp"
                NOTE_PAYLOAD=$(make_note_json "Campaign Brief" "$_ntmp")
                rm -f "$_ntmp"
                NOTE_RESP=$(api_call POST "/rest/notes" "$NOTE_PAYLOAD")
                NOTE_ID=$(echo "$NOTE_RESP" | jq -r '.data.createNote.id // empty')
                if [ -n "$NOTE_ID" ] && [ "$NOTE_ID" != "null" ]; then
                    api_call POST "/rest/noteTargets" "{\\"noteId\\":\\"$NOTE_ID\\",\\"targetWorkItemId\\":\\"$CAM_ID\\"}" > /dev/null
                    echo "Brief note linked"
                fi
            fi
        else
            echo "Failed to create campaign"
            echo "$RESP" | jq -r '.errors[0].message // .'
            exit 1
        fi
        ;;

    list-campaigns)
        RESP=$(api_call GET "/rest/workItems?filter[itemType][eq]=CAMPAIGN")
        echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin)
items = d.get('data', {}).get('workItems', [])
if not items:
    print('No campaigns found.')
else:
    print('{:<38} {:<35} Stage'.format('ID', 'Name'))
    print('-'*80)
    for w in items:
        print('{:<38} {:<35} {}'.format(w['id'], w.get('name',''), w.get('stage','')))
"
        ;;

    get-campaign)
        CAM_ID="${2:-}"
        if [ -z "$CAM_ID" ]; then echo "Usage: get-campaign <campaign_id>"; exit 1; fi
        RESP=$(api_call GET "/rest/workItems/$CAM_ID")
        echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin)
w = d.get('data', {}).get('workItem', {})
print('Campaign:', w.get('name','?'))
print('Stage:   ', w.get('stage','?'))
print('ID:      ', w.get('id','?'))
"
        echo ""
        echo "--- Members ---"
        MEM_RESP=$(api_call GET "/rest/campaignMembers?filter[workItemId][eq]=$CAM_ID")
        echo "$MEM_RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin)
members = d.get('data', {}).get('campaignMembers', [])
if not members:
    print('  (no members yet)')
else:
    for m in members:
        print('  person_id={} member_id={}'.format(m.get('personId','?'), m.get('id','?')))
"
        echo ""
        echo "--- Campaign Notes ---"
        NT_RESP=$(api_call GET "/rest/noteTargets?filter[targetWorkItemId][eq]=$CAM_ID")
        NOTE_IDS=$(echo "$NT_RESP" | jq -r '.data.noteTargets[].noteId // empty' 2>/dev/null)
        if [ -z "$NOTE_IDS" ]; then
            echo "  (no notes yet)"
        else
            for NID in $NOTE_IDS; do
                N=$(api_call GET "/rest/notes/$NID")
                TITLE=$(echo "$N" | jq -r '.data.note.title // ""')
                BODY=$(echo "$N" | jq -r '.data.note.bodyV2.markdown // ""')
                echo "=== $TITLE ==="
                echo "$BODY"
                echo ""
            done
        fi
        ;;

    add-to-campaign)
        PERSON_ID="${2:-}"
        CAM_ID="${3:-}"
        if [ -z "$PERSON_ID" ] || [ -z "$CAM_ID" ]; then
            echo "Usage: add-to-campaign <person_id> <campaign_id>"
            exit 1
        fi
        EXISTING=$(api_call GET "/rest/campaignMembers?filter[workItemId][eq]=$CAM_ID&filter[personId][eq]=$PERSON_ID")
        EXISTING_ID=$(echo "$EXISTING" | jq -r '.data.campaignMembers[0].id // empty' 2>/dev/null)
        if [ -n "$EXISTING_ID" ] && [ "$EXISTING_ID" != "null" ]; then
            echo "Person is already in this campaign (member_id=$EXISTING_ID)"
            exit 0
        fi
        PAYLOAD="{\\"workItemId\\":\\"$CAM_ID\\",\\"personId\\":\\"$PERSON_ID\\"}"
        RESP=$(api_call POST "/rest/campaignMembers" "$PAYLOAD")
        MEM_ID=$(echo "$RESP" | jq -r '.data.createCampaignMember.id // empty')
        if [ -n "$MEM_ID" ] && [ "$MEM_ID" != "null" ]; then
            echo "Person added to campaign (member_id=$MEM_ID)"
        else
            echo "Failed to add to campaign"
            echo "$RESP" | jq -r '.errors[0].message // .'
            exit 1
        fi
        ;;

    remove-from-campaign)
        PERSON_ID="${2:-}"
        CAM_ID="${3:-}"
        if [ -z "$PERSON_ID" ] || [ -z "$CAM_ID" ]; then
            echo "Usage: remove-from-campaign <person_id> <campaign_id>"
            exit 1
        fi
        EXISTING=$(api_call GET "/rest/campaignMembers?filter[workItemId][eq]=$CAM_ID&filter[personId][eq]=$PERSON_ID")
        MEM_ID=$(echo "$EXISTING" | jq -r '.data.campaignMembers[0].id // empty' 2>/dev/null)
        if [ -z "$MEM_ID" ] || [ "$MEM_ID" = "null" ]; then
            echo "Person is not in this campaign"
            exit 0
        fi
        RESP=$(api_call DELETE "/rest/campaignMembers/$MEM_ID")
        if echo "$RESP" | jq -e '.data.deleteCampaignMember.id' >/dev/null 2>&1; then
            echo "Person removed from campaign"
        else
            echo "Failed to remove from campaign"
            echo "$RESP" | jq -r '.errors[0].message // .'
            exit 1
        fi
        ;;

    get-campaign-context)
        PERSON_ID="${2:-}"
        if [ -z "$PERSON_ID" ]; then
            echo "Usage: get-campaign-context <person_id>"
            exit 1
        fi
        MEM_RESP=$(api_call GET "/rest/campaignMembers?filter[personId][eq]=$PERSON_ID")
        CAMPAIGNS=$(echo "$MEM_RESP" | jq -r '.data.campaignMembers[].workItemId // empty' 2>/dev/null)
        if [ -z "$CAMPAIGNS" ]; then
            echo "NO_CAMPAIGNS"
            exit 0
        fi
        for CAM_ID in $CAMPAIGNS; do
            CAM=$(api_call GET "/rest/workItems/$CAM_ID")
            CAM_NAME=$(echo "$CAM" | jq -r '.data.workItem.name // "Unknown"')
            CAM_STAGE=$(echo "$CAM" | jq -r '.data.workItem.stage // ""')
            if [ "$CAM_STAGE" = "DONE" ]; then continue; fi
            echo "=============================="
            echo "CAMPAIGN: $CAM_NAME"
            echo "=============================="
            NT_RESP=$(api_call GET "/rest/noteTargets?filter[targetWorkItemId][eq]=$CAM_ID")
            NOTE_IDS=$(echo "$NT_RESP" | jq -r '.data.noteTargets[].noteId // empty' 2>/dev/null)
            if [ -z "$NOTE_IDS" ]; then
                echo "(no campaign notes found)"
            else
                for NID in $NOTE_IDS; do
                    N=$(api_call GET "/rest/notes/$NID")
                    TITLE=$(echo "$N" | jq -r '.data.note.title // ""')
                    BODY=$(echo "$N" | jq -r '.data.note.bodyV2.markdown // ""')
                    echo "--- $TITLE ---"
                    echo "$BODY"
                    echo ""
                done
            fi
        done
        ;;

    list-campaign-members)
        CAM_ID="${2:-}"
        if [ -z "$CAM_ID" ]; then echo "Usage: list-campaign-members <campaign_id>"; exit 1; fi
        RESP=$(api_call GET "/rest/campaignMembers?filter[workItemId][eq]=$CAM_ID")
        echo "$RESP" | python3 -c "
import json, sys
d = json.load(sys.stdin)
members = d.get('data', {}).get('campaignMembers', [])
if not members:
    print('No members in this campaign.')
else:
    print('Members ({}):'.format(len(members)))
    for m in members:
        print('  member_id={}  person_id={}'.format(m.get('id','?'), m.get('personId','?')))
"
        ;;

'''

with open("/root/.nanobot/tools/twenty_crm_enhanced.sh") as f:
    content = f.read()

MARKER = "    list-notes)"
if "create-campaign)" in content:
    print("Campaign commands already present")
elif MARKER in content:
    content = content.replace(MARKER, CAMPAIGN_COMMANDS + "    " + "list-notes)", 1)
    with open("/root/.nanobot/tools/twenty_crm_enhanced.sh", "w") as f:
        f.write(content)
    print("Campaign commands added successfully")
else:
    print("Marker 'list-notes)' not found")
    # Find where to insert
    for i, line in enumerate(content.split("\n")):
        if "list-" in line and ")" in line:
            print(f"  Line {i}: {line.strip()}")
            break
