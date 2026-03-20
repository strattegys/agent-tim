#!/usr/bin/env python3
"""
Import contacts from B2B SaaS Influencer/Buyer CSV into Twenty CRM.
- Creates a 'stage' SELECT field on Person if it doesn't exist
- Creates each person with LinkedIn, email, job title, company, city
- Determines stage from CSV fields (profileStatus, messageSent, messageReplied, connectedAt, firstMessageAt)
- Links each person to the Agent Army campaign via activeCampaignId

Run on the server where Twenty CRM is accessible at localhost:3000.
Usage: python3 import_campaign_contacts.py /path/to/csv
"""

import csv
import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse

# Force unbuffered output
sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', buffering=1)
sys.stderr = os.fdopen(sys.stderr.fileno(), 'w', buffering=1)

API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzczMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
BASE_URL = "http://localhost:3000"
AGENT_ARMY_CAMPAIGN_ID = "b960a122-5e9e-4f3a-9b1a-7c8d2e4f6a0b"  # Will be looked up

# Stage options with colors for Twenty CRM SELECT field
STAGE_OPTIONS = [
    {"label": "Target", "value": "TARGET", "color": "gray", "position": 0},
    {"label": "Initiated", "value": "INITIATED", "color": "blue", "position": 1},
    {"label": "Accepted", "value": "ACCEPTED", "color": "turquoise", "position": 2},
    {"label": "Engaged", "value": "ENGAGED", "color": "yellow", "position": 3},
    {"label": "Prospect", "value": "PROSPECT", "color": "orange", "position": 4},
    {"label": "Converted", "value": "CONVERTED", "color": "green", "position": 5},
    {"label": "KIT", "value": "KIT", "color": "purple", "position": 6},
    {"label": "DNC", "value": "DNC", "color": "red", "position": 7},
    {"label": "Unqualified", "value": "UNQUALIFIED", "color": "gray", "position": 8},
]


_request_timestamps = []

def api_call(method, endpoint, data=None, retries=5):
    """Make an API call to Twenty CRM with sliding window rate limiting."""
    global _request_timestamps

    # Sliding window: max 80 requests per 60s (limit is 100, leave margin)
    now = time.time()
    _request_timestamps = [t for t in _request_timestamps if now - t < 60]
    if len(_request_timestamps) >= 80:
        oldest = _request_timestamps[0]
        wait = 60 - (now - oldest) + 2  # wait until oldest drops out + buffer
        if wait > 0:
            print(f"  [rate limit] {len(_request_timestamps)} reqs in window, waiting {wait:.0f}s...")
            time.sleep(wait)
            now = time.time()
            _request_timestamps = [t for t in _request_timestamps if now - t < 60]

    _request_timestamps.append(time.time())

    url = f"{BASE_URL}{endpoint}"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    body = json.dumps(data).encode("utf-8") if data else None

    for attempt in range(retries):
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8") if e.fp else ""
            if e.code == 429 and attempt < retries - 1:
                print(f"  [429] Rate limited, waiting 65s... (attempt {attempt+1}/{retries})")
                time.sleep(65)
                _request_timestamps = []  # reset after long wait
                continue
            print(f"  HTTP {e.code} on {method} {endpoint}: {error_body[:300]}")
            return None
        except Exception as e:
            print(f"  Error on {method} {endpoint}: {e}")
            return None
    return None


def find_agent_army_campaign():
    """Find the Agent Army campaign ID."""
    resp = api_call("GET", "/rest/campaigns?limit=50")
    if not resp:
        print("ERROR: Could not list campaigns")
        sys.exit(1)
    campaigns = resp.get("data", {}).get("campaigns", [])
    for c in campaigns:
        name = c.get("name", "").lower()
        if "agent army" in name:
            print(f"Found Agent Army campaign: {c['id']} ({c.get('name')})")
            return c["id"]
    print("ERROR: Agent Army campaign not found. Available campaigns:")
    for c in campaigns:
        print(f"  - {c.get('name')} ({c['id']})")
    sys.exit(1)


def get_person_object_metadata_id():
    """Get the objectMetadataId for the Person object."""
    resp = api_call("GET", "/metadata/objects?filter[nameSingular][eq]=person")
    if resp and resp.get("data", {}).get("objects"):
        obj = resp["data"]["objects"][0]
        print(f"Person objectMetadataId: {obj['id']}")
        return obj["id"]
    # Try without filter
    resp = api_call("GET", "/metadata/objects")
    if resp:
        objects = resp.get("data", {}).get("objects", [])
        for obj in objects:
            if obj.get("nameSingular") == "person":
                print(f"Person objectMetadataId: {obj['id']}")
                return obj["id"]
    print("ERROR: Could not find Person object metadata")
    sys.exit(1)


def check_stage_field_exists(object_metadata_id):
    """Check if stage field already exists on Person."""
    resp = api_call("GET", f"/metadata/fields?filter[objectMetadataId][eq]={object_metadata_id}&filter[name][eq]=stage")
    if resp:
        fields = resp.get("data", {}).get("fields", [])
        for f in fields:
            if f.get("name") == "stage":
                print(f"Stage field already exists: {f['id']}")
                return True
    return False


def create_stage_field(object_metadata_id):
    """Create the Stage SELECT field on Person object."""
    if check_stage_field_exists(object_metadata_id):
        return True

    payload = {
        "name": "stage",
        "label": "Stage",
        "type": "SELECT",
        "objectMetadataId": object_metadata_id,
        "description": "Campaign outreach stage",
        "options": STAGE_OPTIONS,
    }
    resp = api_call("POST", "/metadata/fields", payload)
    if resp:
        field_id = resp.get("data", {}).get("createField", {}).get("id") or resp.get("data", {}).get("field", {}).get("id")
        if field_id:
            print(f"Created stage field: {field_id}")
            return True
        # Check if it was created with different response structure
        print(f"Stage field creation response: {json.dumps(resp)[:300]}")
        return True
    return False


def determine_stage(row):
    """Determine the campaign stage from CSV fields."""
    message_replied = row.get("messageReplied", "").strip().lower() == "yes"
    connected_at = row.get("connectedAt", "").strip()
    profile_status = row.get("profileStatus", "").strip().lower()
    message_sent = row.get("messageSent", "").strip().lower() == "yes"
    first_message_at = row.get("firstMessageAt", "").strip()
    connection_request_date = row.get("connectionRequestDate", "").strip()

    if message_replied:
        return "ENGAGED"
    if connected_at or profile_status == "connected":
        return "ACCEPTED"
    if message_sent or first_message_at:
        return "INITIATED"
    if profile_status == "pending" or connection_request_date:
        return "INITIATED"
    return "TARGET"


def clean_name(name):
    """Clean special characters from names."""
    if not name:
        return ""
    # Remove emoji-like prefixes
    cleaned = name.strip()
    # Remove leading non-alpha characters (emojis, special chars)
    while cleaned and not cleaned[0].isalpha():
        cleaned = cleaned[1:]
    return cleaned.strip()


def build_person_payload(row, campaign_id):
    """Build the Twenty CRM person creation payload from a CSV row."""
    first_name = clean_name(row.get("firstName", "").strip())
    last_name = clean_name(row.get("lastName", "").strip())

    if not first_name and not last_name:
        return None

    payload = {
        "name": {
            "firstName": first_name,
            "lastName": last_name,
        },
        "activeCampaignId": campaign_id,
        "stage": determine_stage(row),
    }

    # Email
    email = (row.get("linkedinEmail") or row.get("proEmail") or "").strip()
    if email:
        payload["emails"] = {"primaryEmail": email}

    # LinkedIn URL
    linkedin_url = row.get("linkedinUrl", "").strip()
    if linkedin_url:
        payload["linkedinLink"] = {
            "primaryLinkUrl": linkedin_url,
            "primaryLinkLabel": "LinkedIn",
        }

    # Job title - use occupation or job_title
    job_title = row.get("occupation", "").strip() or row.get("job_title", "").strip()
    if job_title:
        payload["jobTitle"] = job_title

    # City from location
    location = row.get("location", "").strip()
    if location:
        # Take the city part (first segment before comma or two spaces)
        city = location.split(",")[0].split("  ")[0].strip()
        if city:
            payload["city"] = city

    # Phone
    phone = row.get("phoneNumbers", "").strip()
    if phone:
        payload["phones"] = {"primaryPhoneNumber": phone}

    # Avatar
    avatar_url = row.get("profilePictureUrl", "").strip()
    if avatar_url:
        payload["avatarUrl"] = avatar_url

    return payload


def search_existing_person(linkedin_url=None, first_name=None, last_name=None):
    """Check if person already exists by LinkedIn URL or name."""
    if linkedin_url:
        # Search by LinkedIn URL
        encoded = urllib.parse.quote(linkedin_url, safe="")
        resp = api_call("GET", f'/rest/people?filter[linkedinLink][primaryLinkUrl][eq]={encoded}&limit=1')
        if resp:
            people = resp.get("data", {}).get("people", [])
            if people:
                return people[0]["id"]

    if first_name and last_name:
        # Search by name
        encoded_first = urllib.parse.quote(first_name, safe="")
        encoded_last = urllib.parse.quote(last_name, safe="")
        resp = api_call("GET", f'/rest/people?filter[name][firstName][eq]={encoded_first}&filter[name][lastName][eq]={encoded_last}&limit=1')
        if resp:
            people = resp.get("data", {}).get("people", [])
            if people:
                return people[0]["id"]

    return None


def create_or_find_company(company_name, company_website=None, company_linkedin=None):
    """Create or find a company, return its ID."""
    if not company_name or not company_name.strip():
        return None

    company_name = company_name.strip()

    # Search for existing company
    encoded = urllib.parse.quote(company_name, safe="")
    resp = api_call("GET", f'/rest/companies?filter[name][ilike]=%25{encoded}%25&limit=1')
    if resp:
        companies = resp.get("data", {}).get("companies", [])
        if companies:
            return companies[0]["id"]

    # Create new company
    payload = {"name": company_name}
    if company_website and company_website.strip():
        payload["domainName"] = {
            "primaryLinkUrl": company_website.strip(),
            "primaryLinkLabel": "Website",
        }
    if company_linkedin and company_linkedin.strip():
        payload["linkedinLink"] = {
            "primaryLinkUrl": company_linkedin.strip(),
            "primaryLinkLabel": "LinkedIn",
        }

    resp = api_call("POST", "/rest/companies", payload)
    if resp:
        company_id = (
            resp.get("data", {}).get("createCompany", {}).get("id")
            or resp.get("data", {}).get("company", {}).get("id")
        )
        if company_id:
            return company_id
    return None


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 import_campaign_contacts.py /path/to/csv")
        sys.exit(1)

    csv_path = sys.argv[1]
    dry_run = "--dry-run" in sys.argv

    print("=" * 60)
    print("B2B SaaS Campaign Contact Import")
    print("=" * 60)

    if dry_run:
        print("*** DRY RUN MODE - no changes will be made ***\n")

    # Step 1: Find Agent Army campaign
    print("\n[1/4] Finding Agent Army campaign...")
    campaign_id = find_agent_army_campaign()

    # Step 2: Stage field already exists (created via metadata API)
    print("\n[2/3] Stage field already exists on Person - skipping creation")

    # Step 3: Read CSV
    print(f"\n[3/3] Reading CSV: {csv_path}")
    rows = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    print(f"  Found {len(rows)} contacts")

    # Analyze stage distribution
    stage_counts = {}
    for row in rows:
        stage = determine_stage(row)
        stage_counts[stage] = stage_counts.get(stage, 0) + 1
    print("  Stage distribution:")
    for stage, count in sorted(stage_counts.items()):
        print(f"    {stage}: {count}")

    if dry_run:
        print("\nDry run complete. Exiting.")
        return

    # Import contacts
    print(f"\nImporting {len(rows)} contacts...")
    created = 0
    updated = 0
    skipped = 0
    errors = 0
    company_cache = {}  # name -> id

    for i, row in enumerate(rows):
        first_name = clean_name(row.get("firstName", "").strip())
        last_name = clean_name(row.get("lastName", "").strip())
        linkedin_url = row.get("linkedinUrl", "").strip()

        if not first_name and not last_name:
            skipped += 1
            continue

        # Progress update every 50
        if (i + 1) % 50 == 0:
            print(f"  Progress: {i + 1}/{len(rows)} (created={created}, updated={updated}, skipped={skipped}, errors={errors})")

        # Check for existing person
        existing_id = search_existing_person(linkedin_url, first_name, last_name)

        # Find or create company
        company_name = row.get("company_name", "").strip()
        company_id = None
        if company_name:
            if company_name in company_cache:
                company_id = company_cache[company_name]
            else:
                company_id = create_or_find_company(
                    company_name,
                    row.get("company_website", ""),
                    row.get("company_linkedinUrl", ""),
                )
                if company_id:
                    company_cache[company_name] = company_id

        payload = build_person_payload(row, campaign_id)
        if not payload:
            skipped += 1
            continue

        if company_id:
            payload["companyId"] = company_id

        if existing_id:
            # Update existing person with campaign and stage
            update_payload = {
                "activeCampaignId": campaign_id,
                "stage": payload["stage"],
            }
            resp = api_call("PATCH", f"/rest/people/{existing_id}", update_payload)
            if resp:
                updated += 1
            else:
                errors += 1
        else:
            # Create new person
            resp = api_call("POST", "/rest/people", payload)
            if resp:
                person_id = (
                    resp.get("data", {}).get("createPerson", {}).get("id")
                    or resp.get("data", {}).get("person", {}).get("id")
                )
                if person_id:
                    created += 1
                else:
                    print(f"  Unexpected response for {first_name} {last_name}: {json.dumps(resp)[:200]}")
                    errors += 1
            else:
                errors += 1

    print("\n" + "=" * 60)
    print("Import Complete!")
    print(f"  Created: {created}")
    print(f"  Updated: {updated}")
    print(f"  Skipped: {skipped}")
    print(f"  Errors:  {errors}")
    print(f"  Total:   {len(rows)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
