#!/usr/bin/env python3
"""
Direct DB import of B2B SaaS contacts into Twenty CRM.
Bypasses API rate limits by inserting directly into PostgreSQL.

Usage: python3 import_campaign_contacts_db.py /path/to/csv
  Run inside: docker exec twenty-db-1 python3 ... OR via psql
  Actually: this generates SQL and pipes it to psql.
"""

import csv
import os
import sys
import uuid
import re
from datetime import datetime, timezone

# Force UTF-8 output
if sys.stdout.encoding != 'utf-8':
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
if sys.stderr.encoding != 'utf-8':
    sys.stderr = open(sys.stderr.fileno(), mode='w', encoding='utf-8', buffering=1)

SCHEMA = "workspace_9rc10n79wgdr0r3z6mzti24f6"
CAMPAIGN_ID = "b960a122-9ba2-4e12-a8fe-cb7fc9deac2c"  # Agent Army [C]


def escape_sql(s):
    """Escape single quotes for SQL."""
    if s is None:
        return "NULL"
    s = str(s).strip()
    if not s:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


def clean_name(name):
    if not name:
        return ""
    cleaned = name.strip()
    while cleaned and not cleaned[0].isalpha():
        cleaned = cleaned[1:]
    return cleaned.strip()


def determine_stage(row):
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


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 import_campaign_contacts_db.py /path/to/csv", file=sys.stderr)
        sys.exit(1)

    csv_path = sys.argv[1]

    rows = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)

    print(f"-- Importing {len(rows)} contacts into Twenty CRM", file=sys.stderr)
    print(f"-- Campaign: {CAMPAIGN_ID}", file=sys.stderr)

    now = datetime.now(timezone.utc).isoformat()

    # Collect unique companies with their metadata
    companies = {}  # name -> {id, website, linkedin}
    for row in rows:
        company_name = row.get("company_name", "").strip()
        if company_name and company_name not in companies:
            companies[company_name] = {
                "id": str(uuid.uuid4()),
                "website": (row.get("company_website") or "").strip(),
                "linkedin": (row.get("company_linkedinUrl") or "").strip(),
            }

    # Start transaction
    print("BEGIN;")
    print()

    # Insert companies (skip existing)
    print(f"-- Inserting {len(companies)} companies")
    for company_name, info in companies.items():
        website = info["website"]
        company_linkedin = info["linkedin"]
        print(f"""INSERT INTO {SCHEMA}.company (id, "createdAt", "updatedAt", name, "domainNamePrimaryLinkUrl", "domainNamePrimaryLinkLabel", "linkedinLinkPrimaryLinkUrl", "linkedinLinkPrimaryLinkLabel", position)
SELECT {escape_sql(info['id'])}::uuid, '{now}'::timestamptz, '{now}'::timestamptz, {escape_sql(company_name)}, {escape_sql(website) if website else 'NULL'}, {escape_sql('Website') if website else 'NULL'}, {escape_sql(company_linkedin) if company_linkedin else 'NULL'}, {escape_sql('LinkedIn') if company_linkedin else 'NULL'}, 0
WHERE NOT EXISTS (SELECT 1 FROM {SCHEMA}.company WHERE LOWER(name) = LOWER({escape_sql(company_name)}));""")
    print()

    # Now insert people
    print(f"-- Inserting {len(rows)} people")
    skipped = 0
    inserted = 0

    for row in rows:
        first_name = clean_name(row.get("firstName", "").strip())
        last_name = clean_name(row.get("lastName", "").strip())

        if not first_name and not last_name:
            skipped += 1
            continue

        person_id = str(uuid.uuid4())
        stage = determine_stage(row)
        email = (row.get("linkedinEmail") or row.get("proEmail") or "").strip()
        linkedin_url = row.get("linkedinUrl", "").strip()
        job_title = (row.get("occupation") or row.get("job_title") or "").strip()
        location = row.get("location", "").strip()
        city = location.split(",")[0].split("  ")[0].strip() if location else ""
        phone = row.get("phoneNumbers", "").strip()
        avatar_url = row.get("profilePictureUrl", "").strip()
        company_name = row.get("company_name", "").strip()

        # Build company subquery
        if company_name:
            company_subquery = f"(SELECT id FROM {SCHEMA}.company WHERE LOWER(name) = LOWER({escape_sql(company_name)}) LIMIT 1)"
        else:
            company_subquery = "NULL"

        # Skip if person already exists (by linkedin URL or name)
        if linkedin_url:
            exists_check = f"""NOT EXISTS (SELECT 1 FROM {SCHEMA}.person WHERE "linkedinLinkPrimaryLinkUrl" = {escape_sql(linkedin_url)} AND "deletedAt" IS NULL)"""
        else:
            exists_check = f"""NOT EXISTS (SELECT 1 FROM {SCHEMA}.person WHERE "nameFirstName" = {escape_sql(first_name)} AND "nameLastName" = {escape_sql(last_name)} AND "deletedAt" IS NULL)"""

        print(f"""INSERT INTO {SCHEMA}.person (id, "createdAt", "updatedAt", "nameFirstName", "nameLastName", "emailsPrimaryEmail", "linkedinLinkPrimaryLinkUrl", "linkedinLinkPrimaryLinkLabel", "jobTitle", city, "phonesPrimaryPhoneNumber", "avatarUrl", "activeCampaignId", stage, "companyId", position)
SELECT {escape_sql(person_id)}::uuid, '{now}'::timestamptz, '{now}'::timestamptz, {escape_sql(first_name)}, {escape_sql(last_name)}, {escape_sql(email) if email else 'NULL'}, {escape_sql(linkedin_url) if linkedin_url else 'NULL'}, {escape_sql('LinkedIn') if linkedin_url else 'NULL'}, {escape_sql(job_title) if job_title else 'NULL'}, {escape_sql(city) if city else 'NULL'}, {escape_sql(phone) if phone else 'NULL'}, {escape_sql(avatar_url) if avatar_url else 'NULL'}, '{CAMPAIGN_ID}'::uuid, '{stage}'::{SCHEMA}.person_stage_enum, {company_subquery}, 0
WHERE {exists_check};""")
        inserted += 1

    # Also update existing people that are already in the DB but not linked to campaign
    print()
    print("-- Update existing people: link to campaign and set stage for those already imported without it")

    print()
    print("COMMIT;")

    print(f"-- Skipped {skipped} rows with no name", file=sys.stderr)
    print(f"-- Generated INSERT for {inserted} people", file=sys.stderr)
    print(f"-- Companies: {len(companies)}", file=sys.stderr)


if __name__ == "__main__":
    main()
