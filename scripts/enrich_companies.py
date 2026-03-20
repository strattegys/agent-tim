#!/usr/bin/env python3
"""
Enrich campaign contacts missing company info via Apollo People Match API,
then link them to companies in Twenty CRM via direct DB access.

Run on the server: python3 -u enrich_companies.py
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid

sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', buffering=1)
sys.stderr = os.fdopen(sys.stderr.fileno(), 'w', buffering=1)

# Apollo config
APOLLO_API_KEY = "deVXTbyaLYzuQtlv3bwBZA"
APOLLO_BASE = "https://api.apollo.io/api/v1"

# Twenty CRM DB
WS = "workspace_9rc10n79wgdr0r3z6mzti24f6"
CAMPAIGN_ID = "b960a122-9ba2-4e12-a8fe-cb7fc9deac2c"


def db_query(sql):
    """Run a SQL query via docker exec and return rows."""
    result = subprocess.run(
        ["docker", "exec", "twenty-db-1", "psql", "-U", "postgres", "-d", "default",
         "-t", "-A", "-F", "\t", "-c", sql],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  DB ERROR: {result.stderr.strip()}")
        return []
    rows = []
    for line in result.stdout.strip().split("\n"):
        if line:
            rows.append(line.split("\t"))
    return rows


def db_exec(sql):
    """Run a SQL statement."""
    result = subprocess.run(
        ["docker", "exec", "twenty-db-1", "psql", "-U", "postgres", "-d", "default", "-c", sql],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  DB ERROR: {result.stderr.strip()}")
        return False
    return True


def apollo_enrich(linkedin_url):
    """Call Apollo People Match API. Returns dict with company_name, title, city, email or None."""
    if not linkedin_url or "/in/" not in linkedin_url:
        return None
    try:
        payload = json.dumps({
            "linkedin_url": linkedin_url,
            "reveal_personal_emails": False,
        }).encode()
        req = urllib.request.Request(
            f"{APOLLO_BASE}/people/match",
            data=payload,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "x-api-key": APOLLO_API_KEY,
                "User-Agent": "Mozilla/5.0",
            },
        )
        resp = urllib.request.urlopen(req, timeout=60)
        data = json.loads(resp.read())
        person = data.get("person") or {}
        if not person:
            return None

        # Current company: prefer employment_history current=True with a title
        company_name = None
        title = None
        for job in person.get("employment_history") or []:
            if job.get("current"):
                if job.get("title"):
                    company_name = job.get("organization_name")
                    title = job.get("title")
                break
        if not company_name:
            org = person.get("organization") or {}
            company_name = org.get("name")
        if not title:
            title = person.get("title")

        return {
            "company_name": company_name,
            "title": title,
            "city": person.get("city"),
            "email": person.get("email"),
            "company_domain": (person.get("organization") or {}).get("primary_domain"),
            "company_linkedin": (person.get("organization") or {}).get("linkedin_url"),
        }
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")[:200] if e.fp else ""
        print(f"  Apollo HTTP {e.code}: {body}")
        if e.code == 429:
            print("  Rate limited by Apollo, waiting 60s...")
            time.sleep(60)
        return None
    except Exception as e:
        print(f"  Apollo error: {e}")
        return None


def find_or_create_company(company_name, domain=None, linkedin_url=None):
    """Find existing company in DB or create one, return ID."""
    escaped = company_name.replace("'", "''")

    # Search by name (case-insensitive)
    rows = db_query(
        f"SELECT id FROM {WS}.company WHERE \"deletedAt\" IS NULL AND name ILIKE '{escaped}' LIMIT 1;"
    )
    if rows and rows[0][0]:
        return rows[0][0]

    # Fuzzy search
    rows = db_query(
        f"SELECT id FROM {WS}.company WHERE \"deletedAt\" IS NULL AND name ILIKE '%{escaped}%' LIMIT 1;"
    )
    if rows and rows[0][0]:
        return rows[0][0]

    # Create new
    new_id = str(uuid.uuid4())
    domain_col = ""
    domain_val = ""
    if domain:
        escaped_domain = domain.replace("'", "''")
        domain_col = ', "domainNamePrimaryLinkUrl"'
        domain_val = f", '{escaped_domain}'"

    ok = db_exec(
        f"INSERT INTO {WS}.company (id, name{domain_col}, \"createdAt\", \"updatedAt\", position) "
        f"VALUES ('{new_id}', '{escaped}'{domain_val}, NOW(), NOW(), 0);"
    )
    if ok:
        print(f"    Created company: {company_name} ({new_id})")
        return new_id
    return None


def main():
    print("=" * 60)
    print("Company Enrichment via Apollo")
    print("=" * 60)

    # Get people missing companies in the Agent Army campaign
    rows = db_query(
        f'SELECT id, "nameFirstName", "nameLastName", "linkedinLinkPrimaryLinkUrl", "jobTitle" '
        f'FROM {WS}.person '
        f'WHERE "activeCampaignId" = \'{CAMPAIGN_ID}\' '
        f'AND "deletedAt" IS NULL '
        f'AND "companyId" IS NULL '
        f'AND "linkedinLinkPrimaryLinkUrl" IS NOT NULL '
        f'AND "linkedinLinkPrimaryLinkUrl" != \'\' '
        f'ORDER BY "nameLastName";'
    )

    print(f"\nFound {len(rows)} people missing company info\n")

    if not rows:
        print("Nothing to do!")
        return

    enriched = 0
    not_found = 0
    failed = 0

    for i, row in enumerate(rows):
        person_id = row[0]
        first = row[1] if len(row) > 1 else ""
        last = row[2] if len(row) > 2 else ""
        linkedin_url = row[3] if len(row) > 3 else ""
        job_title = row[4] if len(row) > 4 else ""

        print(f"[{i+1}/{len(rows)}] {first} {last}")

        # Apollo rate limit: ~5 req/s is safe, add small delay
        if i > 0:
            time.sleep(1)

        apollo = apollo_enrich(linkedin_url)
        if not apollo:
            not_found += 1
            continue

        company_name = apollo.get("company_name")
        if not company_name:
            print(f"  Apollo matched but no company")
            not_found += 1
            continue

        print(f"  Apollo: {apollo.get('title', '')} @ {company_name}")

        company_id = find_or_create_company(
            company_name,
            domain=apollo.get("company_domain"),
            linkedin_url=apollo.get("company_linkedin"),
        )
        if not company_id:
            failed += 1
            continue

        # Build update: company + optional title, city, email
        updates = [f'"companyId" = \'{company_id}\'']
        apollo_title = apollo.get("title")
        if apollo_title and not job_title:
            updates.append(f'"jobTitle" = \'{apollo_title.replace(chr(39), chr(39)+chr(39))}\'')
        apollo_city = apollo.get("city")
        if apollo_city:
            updates.append(f'"city" = \'{apollo_city.replace(chr(39), chr(39)+chr(39))}\'')
        apollo_email = apollo.get("email")
        if apollo_email:
            updates.append(f'"emailsPrimaryEmail" = \'{apollo_email.replace(chr(39), chr(39)+chr(39))}\'')

        updates.append('"updatedAt" = NOW()')

        ok = db_exec(
            f'UPDATE {WS}.person SET {", ".join(updates)} WHERE id = \'{person_id}\';'
        )
        if ok:
            enriched += 1
        else:
            failed += 1

    print("\n" + "=" * 60)
    print("Enrichment Complete!")
    print(f"  Enriched:   {enriched}")
    print(f"  Not found:  {not_found}")
    print(f"  Failed:     {failed}")
    print(f"  Total:      {len(rows)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
