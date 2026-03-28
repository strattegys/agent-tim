#!/bin/bash
# Twenty CRM Integration Tool for Cloud Nanobot Tim
# Connects to Twenty CRM REST API

API_KEY="${TWENTY_CRM_API_KEY}"
BASE_URL="${TWENTY_CRM_URL:-http://localhost:3000}"

# Helper function for API calls
api_call() {
    local method="$1"
    local endpoint="$2"
    local data="$3"

    if [ -n "$data" ]; then
        curl -s -X "$method" "${BASE_URL}${endpoint}" \
            -H "Authorization: Bearer ${API_KEY}" \
            -H "Content-Type: application/json" \
            -d "$data"
    else
        curl -s -X "$method" "${BASE_URL}${endpoint}" \
            -H "Authorization: Bearer ${API_KEY}"
    fi
}

# Helper function to create and link note to target
create_linked_note() {
    local target_id="$1"
    local target_type="$2"
    local note_title="$3"
    local note_body="$4"

    local note_payload="{\"title\":\"${note_title}\",\"bodyV2\":{\"markdown\":\"${note_body}\"}}"
    local note_response=$(api_call POST "/rest/notes" "$note_payload")
    local note_id=$(echo "$note_response" | jq -r '.data.createNote.id // empty')

    if [ -n "$note_id" ] && [ "$note_id" != "null" ]; then
        local target_field="target${target_type^}Id"
        local link_payload="{\"noteId\":\"${note_id}\",\"${target_field}\":\"${target_id}\"}"
        local link_response=$(api_call POST "/rest/noteTargets" "$link_payload")

        if echo "$link_response" | jq -e '.data.createNoteTarget.id' >/dev/null 2>&1; then
            echo "Note created and linked successfully"
            return 0
        else
            echo "Note created but failed to link: $link_response" >&2
            return 1
        fi
    else
        echo "Failed to create note: $note_response" >&2
        return 1
    fi
}

case "$1" in
    # PEOPLE/CONTACTS
    list-contacts)
        api_call GET "/rest/people"
        ;;
    search-contacts)
        QUERY="${2:-}"
        api_call GET "/rest/people?filter[name][ilike]=%${QUERY}%"
        ;;
    get-contact)
        api_call GET "/rest/people/$2"
        ;;
    create-contact)
        api_call POST "/rest/people" "$2"
        ;;
    update-contact)
        api_call PATCH "/rest/people/$2" "$3"
        ;;
    delete-contact)
        api_call DELETE "/rest/people/$2"
        ;;

    # COMPANIES
    list-companies)
        api_call GET "/rest/companies"
        ;;
    search-companies)
        QUERY="${2:-}"
        api_call GET "/rest/companies?filter[name][ilike]=%${QUERY}%"
        ;;
    get-company)
        api_call GET "/rest/companies/$2"
        ;;
    create-company)
        api_call POST "/rest/companies" "$2"
        ;;
    update-company)
        api_call PATCH "/rest/companies/$2" "$3"
        ;;
    delete-company)
        api_call DELETE "/rest/companies/$2"
        ;;

    # OPPORTUNITIES/DEALS
    list-opportunities)
        api_call GET "/rest/opportunities"
        ;;
    search-opportunities)
        QUERY="${2:-}"
        api_call GET "/rest/opportunities?filter[name][ilike]=%${QUERY}%"
        ;;
    get-opportunity)
        api_call GET "/rest/opportunities/$2"
        ;;
    create-opportunity)
        api_call POST "/rest/opportunities" "$2"
        ;;
    update-opportunity)
        api_call PATCH "/rest/opportunities/$2" "$3"
        ;;
    delete-opportunity)
        api_call DELETE "/rest/opportunities/$2"
        ;;

    # TASKS
    list-tasks)
        api_call GET "/rest/tasks"
        ;;
    search-tasks)
        QUERY="${2:-}"
        api_call GET "/rest/tasks?filter[title][ilike]=%${QUERY}%"
        ;;
    get-task)
        api_call GET "/rest/tasks/$2"
        ;;
    create-task)
        api_call POST "/rest/tasks" "$2"
        ;;
    create-task-target)
        api_call POST "/rest/taskTargets" "$2"
        ;;
    update-task)
        api_call PATCH "/rest/tasks/$2" "$3"
        ;;
    delete-task)
        api_call DELETE "/rest/tasks/$2"
        ;;

    # WORK ITEMS
    list-work-items)
        api_call GET "/rest/workItems"
        ;;
    search-work-items)
        QUERY="${2:-}"
        api_call GET "/rest/workItems?filter[title][ilike]=%${QUERY}%"
        ;;
    get-work-item)
        api_call GET "/rest/workItems/$2"
        ;;
    create-work-item)
        api_call POST "/rest/workItems" "$2"
        ;;
    create-work-item-target)
        api_call POST "/rest/workItemTargets" "$2"
        ;;
    update-work-item)
        api_call PATCH "/rest/workItems/$2" "$3"
        ;;
    delete-work-item)
        api_call DELETE "/rest/workItems/$2"
        ;;

    # NOTES
    list-notes)
        api_call GET "/rest/notes"
        ;;
    get-note)
        api_call GET "/rest/notes/$2"
        ;;
    create-note)
        api_call POST "/rest/notes" "$2"
        ;;
    create-note-target)
        api_call POST "/rest/noteTargets" "$2"
        ;;
    create-linked-note)
        create_linked_note "$2" "$3" "$4" "$5"
        ;;
    update-note)
        api_call PATCH "/rest/notes/$2" "$3"
        ;;
    delete-note)
        api_call DELETE "/rest/notes/$2"
        ;;

    # ACTIVITIES/TIMELINE
    list-activities)
        api_call GET "/rest/timelineActivities"
        ;;
    get-activity)
        api_call GET "/rest/timelineActivities/$2"
        ;;
    create-activity)
        api_call POST "/rest/timelineActivities" "$2"
        ;;

    # MESSAGES
    list-messages)
        api_call GET "/rest/messages"
        ;;
    get-message)
        api_call GET "/rest/messages/$2"
        ;;
    create-message)
        api_call POST "/rest/messages" "$2"
        ;;

    # MESSAGE THREADS
    list-message-threads)
        api_call GET "/rest/messageThreads"
        ;;
    get-message-thread)
        api_call GET "/rest/messageThreads/$2"
        ;;

    # CALENDAR EVENTS
    list-calendar-events)
        api_call GET "/rest/calendarEvents"
        ;;
    get-calendar-event)
        api_call GET "/rest/calendarEvents/$2"
        ;;
    create-calendar-event)
        api_call POST "/rest/calendarEvents" "$2"
        ;;
    update-calendar-event)
        api_call PATCH "/rest/calendarEvents/$2" "$3"
        ;;
    delete-calendar-event)
        api_call DELETE "/rest/calendarEvents/$2"
        ;;

    # ATTACHMENTS
    list-attachments)
        api_call GET "/rest/attachments"
        ;;
    get-attachment)
        api_call GET "/rest/attachments/$2"
        ;;
    create-attachment)
        api_call POST "/rest/attachments" "$2"
        ;;
    delete-attachment)
        api_call DELETE "/rest/attachments/$2"
        ;;

    # FAVORITES
    list-favorites)
        api_call GET "/rest/favorites"
        ;;
    create-favorite)
        api_call POST "/rest/favorites" "$2"
        ;;
    delete-favorite)
        api_call DELETE "/rest/favorites/$2"
        ;;

    # WORKFLOWS
    list-workflows)
        api_call GET "/rest/workflows"
        ;;
    get-workflow)
        api_call GET "/rest/workflows/$2"
        ;;
    create-workflow)
        api_call POST "/rest/workflows" "$2"
        ;;
    update-workflow)
        api_call PATCH "/rest/workflows/$2" "$3"
        ;;
    delete-workflow)
        api_call DELETE "/rest/workflows/$2"
        ;;

    # CONNECTED ACCOUNTS
    list-connected-accounts)
        api_call GET "/rest/connectedAccounts"
        ;;
    get-connected-account)
        api_call GET "/rest/connectedAccounts/$2"
        ;;

    # WORKSPACE MEMBERS
    list-workspace-members)
        api_call GET "/rest/workspaceMembers"
        ;;
    get-workspace-member)
        api_call GET "/rest/workspaceMembers/$2"
        ;;

    *)
        echo "Twenty CRM Tool"
        echo ""
        echo "CONTACTS: list-contacts, search-contacts <query>, get-contact <id>"
        echo "  create-contact <json>, update-contact <id> <json>, delete-contact <id>"
        echo "COMPANIES: list-companies, search-companies <query>, get-company <id>"
        echo "  create-company <json>, update-company <id> <json>, delete-company <id>"
        echo "OPPORTUNITIES: list-opportunities, search-opportunities <query>, get-opportunity <id>"
        echo "  create-opportunity <json>, update-opportunity <id> <json>, delete-opportunity <id>"
        echo "TASKS: list-tasks, search-tasks <query>, get-task <id>"
        echo "  create-task <json>, update-task <id> <json>, delete-task <id>"
        echo "WORK ITEMS: list-work-items, search-work-items <query>, get-work-item <id>"
        echo "  create-work-item <json>, update-work-item <id> <json>, delete-work-item <id>"
        echo "NOTES: list-notes, get-note <id>, create-note <json>"
        echo "  create-linked-note <target_id> <target_type> <title> <body>"
        echo "  update-note <id> <json>, delete-note <id>"
        echo "CALENDAR: list-calendar-events, create-calendar-event <json>"
        echo "OTHER: list-activities, list-messages, list-workflows"
        exit 1
        ;;
esac
