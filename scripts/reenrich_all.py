#!/usr/bin/env python3
"""
Re-enrich all existing contacts using Apollo.
For ACoAAA LinkedIn URLs, first tries to resolve to vanity URL via ConnectSafely.
"""
import json, urllib.request, re, sys, subprocess, datetime

# ── Config ───────────────────────────────────────────────────────────────────
with open("/root/.nanobot/tools/twenty_crm_enhanced.sh") as f:
    sh = f.read()
TWENTY_API_KEY = re.search(r'API_KEY="([^"]+)"', sh).group(1)
TWENTY_BASE = "http://localhost:3000"
APOLLO_API_KEY = "deVXTbyaLYzuQtlv3bwBZA"
APOLLO_BASE = "https://api.apollo.io/api/v1"
CONNECTSAFELY_API_KEY = "1df1fdda-51e5-46c1-8a97-99dde05a11d1"
CONNECTSAFELY_ACCOUNT_ID = "699fbf3eb09b5425c73d4b81"
CS_BASE = "https://api.connectsafely.ai"
LINKEDIN_TOOL = "/root/.nanobot/tools/linkedin.sh"

def twenty(method, path, payload=None):
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(f"{TWENTY_BASE}{path}", data=data, method=method,
        headers={"Authorization": f"Bearer {TWENTY_API_KEY}", "Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=15).read())
    except Exception as e:
        return {"error": str(e)}

def resolve_vanity(linkedin_url, contact_name):
    """Try to resolve ACoAAA URL to vanity via ConnectSafely fetch-profile + name check."""
    if not linkedin_url or "ACoA" not in linkedin_url:
        return linkedin_url  # already vanity or empty
    profile_id = linkedin_url.split("/in/", 1)[1].rstrip("/")
    try:
        result = subprocess.run(
            ["bash", LINKEDIN_TOOL, "fetch-profile", profile_id],
            capture_output=True, text=True, timeout=30)
        prof = json.loads(result.stdout)
        if not prof.get("success"):
            return linkedin_url
        p = prof.get("profile", {})
        public_id = p.get("publicIdentifier") or ""
        fetched_first = p.get("firstName") or ""
        expected_first = contact_name.split()[0] if contact_name else ""
        if public_id and fetched_first.lower() == expected_first.lower():
            vanity = f"https://www.linkedin.com/in/{public_id}"
            print(f"    Resolved vanity: {vanity}")
            return vanity
        else:
            print(f"    Vanity resolution failed ({fetched_first!r} vs {expected_first!r})")
            return linkedin_url
    except Exception as e:
        print(f"    Resolve error: {e}")
        return linkedin_url

def apollo_enrich(linkedin_url, name=None):
    """Call Apollo People Match — needs vanity URL for best results."""
    if not linkedin_url or "/in/" not in linkedin_url:
        return None
    try:
        body = {"linkedin_url": linkedin_url, "reveal_personal_emails": False}
        # Optionally add name as hint for better matching
        if name:
            parts = name.split()
            if len(parts) >= 2:
                body["first_name"] = parts[0]
                body["last_name"] = parts[-1]
        payload = json.dumps(body).encode()
        req = urllib.request.Request(f"{APOLLO_BASE}/people/match", data=payload, method="POST",
            headers={"Content-Type": "application/json", "x-api-key": APOLLO_API_KEY,
                     "User-Agent": "Mozilla/5.0"})
        data = json.loads(urllib.request.urlopen(req, timeout=15).read())
        person = data.get("person") or {}
        if not person:
            return None
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

def find_or_create_company(company_name, all_cos):
    matches = [c for c in all_cos if c.get("name","").lower() == company_name.lower()]
    if matches:
        return matches[0]["id"], False
    r = twenty("POST", "/rest/companies", {"name": company_name})
    co_id = r.get("data", {}).get("createCompany", {}).get("id")
    return co_id, True

# ── Main ─────────────────────────────────────────────────────────────────────
people = twenty("GET", "/rest/people?paging[first]=200").get("data", {}).get("people", [])
all_cos = twenty("GET", "/rest/companies?paging[first]=200").get("data", {}).get("companies", [])
cos_by_id = {c["id"]: c["name"] for c in all_cos}

print(f"Enriching {len(people)} contacts via Apollo...\n")

for p in sorted(people, key=lambda x: (x.get("name") or {}).get("firstName", "")):
    n = p.get("name") or {}
    full_name = f"{n.get('firstName','')} {n.get('lastName','')}".strip()
    li = p.get("linkedinLink") or {}
    linkedin_url = li.get("primaryLinkUrl", "")

    if not linkedin_url:
        print(f"  {full_name:28s} — no LinkedIn URL, skipping")
        continue

    url_display = linkedin_url.split("/in/")[-1][:35]
    print(f"  {full_name:28s} | {url_display}")

    # For ACoAAA URLs, try resolving to vanity first
    resolved_url = linkedin_url
    if "ACoA" in linkedin_url:
        resolved_url = resolve_vanity(linkedin_url, full_name)
        # If we resolved to vanity, update stored URL in CRM
        if resolved_url != linkedin_url:
            sec_links = li.get("secondaryLinks") or []
            # Only add ACoAAA as secondary if not already there
            already_secondary = any("ACoA" in (s.get("url","")) for s in sec_links)
            if not already_secondary:
                sec_links = [{"url": linkedin_url, "label": "LinkedIn (internal)"}] + sec_links
            twenty("PATCH", f"/rest/people/{p['id']}", {
                "linkedinLink": {
                    "primaryLinkUrl": resolved_url,
                    "primaryLinkLabel": "LinkedIn",
                    "secondaryLinks": sec_links,
                }
            })
            print(f"    Updated stored LinkedIn URL to vanity")

    apollo = apollo_enrich(resolved_url, full_name)
    if not apollo or (not apollo.get("title") and not apollo.get("company_name")):
        print(f"    → Apollo: no match")
        continue

    co = apollo.get("company_name")
    title = apollo.get("title")
    city = apollo.get("city")
    email = apollo.get("email")
    print(f"    → Apollo: {title} @ {co}  [{city}]  email={'yes' if email else 'no'}")

    updates = {}
    current_title = p.get("jobTitle") or ""
    if title and title != current_title:
        updates["jobTitle"] = title

    current_city = p.get("city") or ""
    if city and not current_city:
        updates["city"] = city

    current_email = (p.get("emails") or {}).get("primaryEmail") or ""
    if email and not current_email:
        updates["emails"] = {"primaryEmail": email, "additionalEmails": []}

    if updates:
        twenty("PATCH", f"/rest/people/{p['id']}", updates)
        print(f"    Updated fields: {list(updates.keys())}")

    current_co_id = p.get("companyId")
    current_co_name = cos_by_id.get(current_co_id, "") if current_co_id else ""

    if co and co.lower() != current_co_name.lower():
        co_id, created = find_or_create_company(co, all_cos)
        if created:
            all_cos.append({"id": co_id, "name": co})
            cos_by_id[co_id] = co
        if co_id:
            twenty("PATCH", f"/rest/people/{p['id']}", {"companyId": co_id})
            action = "Created+linked" if created else "Linked"
            print(f"    {action} company: {co}")
    elif co:
        print(f"    Company unchanged: {co}")

print("\nDone.")
