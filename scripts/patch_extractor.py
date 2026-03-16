#!/usr/bin/env python3
"""Patch linkedin_extractor.py to add Apollo enrichment."""

with open("/root/.nanobot/tools/linkedin_extractor.py") as f:
    content = f.read()

# ── 1. Add APOLLO constants after TELEGRAM_TOKEN ─────────────────────────────
old_const = 'TELEGRAM_TOKEN = "8784616714:AAEAeJJ25_ypScrEJvEl2QFwgHC51-7HATw"'
new_const = (
    'TELEGRAM_TOKEN = "8784616714:AAEAeJJ25_ypScrEJvEl2QFwgHC51-7HATw"\n'
    'APOLLO_API_KEY = "deVXTbyaLYzuQtlv3bwBZA"\n'
    'APOLLO_BASE = "https://api.apollo.io/api/v1"'
)
assert old_const in content, "TELEGRAM_TOKEN constant not found"
content = content.replace(old_const, new_const)
print("✓ Added Apollo constants")

# ── 2. Insert apollo_enrich() before enrich_contact() ────────────────────────
marker = "def enrich_contact(contact_id, participant):"
assert marker in content, "enrich_contact marker not found"

apollo_fn = '''def apollo_enrich(linkedin_url):
    """
    Call Apollo People Match API with a LinkedIn URL.
    Returns dict: {company_name, title, city, email} — values may be None.
    Returns None if API call fails or no match found.
    """
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
            },
        )
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read())
        person = data.get("person") or {}
        if not person:
            return None

        # Current company from employment_history (current=True), then org object
        company_name = None
        for job in person.get("employment_history") or []:
            if job.get("current"):
                company_name = job.get("organization_name")
                break
        if not company_name:
            org = person.get("organization") or {}
            company_name = org.get("name")

        return {
            "company_name": company_name or None,
            "title": person.get("title") or None,
            "city": person.get("city") or None,
            "email": person.get("email") or None,
        }
    except Exception as e:
        print(f"    Apollo error: {e}")
        return None


'''

content = content.replace(marker, apollo_fn + marker)
print("✓ Inserted apollo_enrich() function")

# ── 3. Replace the body of enrich_contact from "# Update contact fields" ─────
old_body = '''    # Update contact fields
    updates = {"jobTitle": headline}
    if city:
        updates["city"] = city
    twenty("PATCH", f"/rest/people/{contact_id}", updates)

    # Company: parse from headline, find or create
    company_name = try_extract_company_from_headline(headline)
    if company_name:
        company_id = None
        try:
            co_resp = subprocess.run(
                ["bash", CRM_TOOL, "search-companies", company_name],
                capture_output=True, text=True, timeout=15
            )
            co_data = json.loads(co_resp.stdout)
            co_list = co_data.get("data", {}).get("companies", [])
            # exact name match (case-insensitive)
            matches = [c for c in co_list if c.get("name","").lower() == company_name.lower()]
            if matches:
                company_id = matches[0]["id"]
                print(f"    Found company: {company_name} ({company_id})")
        except Exception:
            pass

        if not company_id:
            co_create = twenty("POST", "/rest/companies", {"name": company_name})
            company_id = co_create.get("data", {}).get("createCompany", {}).get("id")
            if company_id:
                print(f"    Created company: {company_name} ({company_id})")

        if company_id:
            twenty("PATCH", f"/rest/people/{contact_id}", {"companyId": company_id})

    # Write profile summary note
    note_lines = ["## LinkedIn Profile Summary\\n"]
    note_lines.append(f"**Headline:** {headline}")
    if city:
        note_lines.append(f"**Location:** {city}")
    if company_name:
        note_lines.append(f"**Company (parsed from headline):** {company_name}")
    if linkedin_url:
        note_lines.append(f"**LinkedIn:** {linkedin_url}")
    note_lines.append(f"\\n*Enriched: {datetime.date.today().isoformat()}*")

    _write_note("LinkedIn Profile Summary", "\\n".join(note_lines), "person", contact_id)
    print(f"    Enrichment done: {headline[:60]}")'''

new_body = '''    # Apollo enrichment — primary source for company, title, city, email
    apollo = apollo_enrich(linkedin_url)
    if apollo:
        print(f"    Apollo: {apollo.get('title')} @ {apollo.get('company_name')}")
    else:
        print(f"    Apollo: no match")

    # Job title: prefer Apollo's clean title, fall back to full headline
    job_title = (apollo and apollo.get("title")) or headline

    # City: Apollo > ConnectSafely fetch-profile
    if not city and apollo:
        city = apollo.get("city") or ""

    # Email: store if Apollo found one
    apollo_email = apollo and apollo.get("email") or None

    # Build contact field updates
    updates = {"jobTitle": job_title}
    if city:
        updates["city"] = city
    if apollo_email:
        updates["emails"] = {"primaryEmail": apollo_email, "additionalEmails": []}
    twenty("PATCH", f"/rest/people/{contact_id}", updates)

    # Company: Apollo first, then headline parsing as fallback
    company_name = (apollo and apollo.get("company_name")) or try_extract_company_from_headline(headline)
    company_source = "Apollo" if (apollo and apollo.get("company_name")) else "headline"

    if company_name:
        company_id = None
        # Fetch all companies and exact-match to avoid duplicates
        all_cos = twenty("GET", "/rest/companies?paging[first]=200")
        co_list = all_cos.get("data", {}).get("companies", [])
        matches = [c for c in co_list if c.get("name", "").lower() == company_name.lower()]
        if matches:
            company_id = matches[0]["id"]
            print(f"    Found company: {company_name} ({company_id})")
        else:
            co_create = twenty("POST", "/rest/companies", {"name": company_name})
            company_id = co_create.get("data", {}).get("createCompany", {}).get("id")
            if company_id:
                print(f"    Created company: {company_name} ({company_id})")

        if company_id:
            twenty("PATCH", f"/rest/people/{contact_id}", {"companyId": company_id})

    # Write profile summary note
    note_lines = ["## LinkedIn Profile Summary\\n"]
    note_lines.append(f"**Headline:** {headline}")
    if job_title and job_title != headline:
        note_lines.append(f"**Title:** {job_title}")
    if city:
        note_lines.append(f"**Location:** {city}")
    if company_name:
        note_lines.append(f"**Company ({company_source}):** {company_name}")
    if apollo_email:
        note_lines.append(f"**Email (Apollo):** {apollo_email}")
    if linkedin_url:
        note_lines.append(f"**LinkedIn:** {linkedin_url}")
    note_lines.append(f"\\n*Enriched: {datetime.date.today().isoformat()}*")

    _write_note("LinkedIn Profile Summary", "\\n".join(note_lines), "person", contact_id)
    print(f"    Enrichment done: {job_title[:60]}")'''

assert old_body in content, "old enrich_contact body not found"
content = content.replace(old_body, new_body)
print("✓ Replaced enrich_contact body with Apollo-first logic")

with open("/root/.nanobot/tools/linkedin_extractor.py", "w") as f:
    f.write(content)
print("✓ File written successfully")
