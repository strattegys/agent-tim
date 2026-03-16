#!/usr/bin/env python3
"""
For every contact with an ACoAAA primary LinkedIn URL:
1. Search ConnectSafely by name, match result by profileUrn containing the stored ACoAAA ID
2. If matched, update CRM: primaryLinkUrl = vanity, secondaryLinks = [ACoAAA]
3. Then call Apollo with the vanity URL to enrich company + title

For contacts already on vanity URLs, still call Apollo to fill missing company.
"""
import json, urllib.request, re, subprocess, datetime

# ── Config ───────────────────────────────────────────────────────────────────
with open("/root/.nanobot/tools/twenty_crm_enhanced.sh") as f:
    sh = f.read()
TWENTY_API_KEY = re.search(r'API_KEY="([^"]+)"', sh).group(1)
TWENTY_BASE    = "http://localhost:3000"
APOLLO_API_KEY = "deVXTbyaLYzuQtlv3bwBZA"
APOLLO_BASE    = "https://api.apollo.io/api/v1"
CS_API_KEY     = "1df1fdda-51e5-46c1-8a97-99dde05a11d1"
CS_ACCOUNT_ID  = "699fbf3eb09b5425c73d4b81"
CS_BASE        = "https://api.connectsafely.ai"
LINKEDIN_TOOL  = "/root/.nanobot/tools/linkedin.sh"

def twenty(method, path, payload=None):
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(f"{TWENTY_BASE}{path}", data=data, method=method,
        headers={"Authorization": f"Bearer {TWENTY_API_KEY}", "Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=15).read())
    except Exception as e:
        return {"error": str(e)}

def cs_search(name):
    payload = json.dumps({"accountId": CS_ACCOUNT_ID, "keywords": name, "limit": 10}).encode()
    req = urllib.request.Request(f"{CS_BASE}/linkedin/search/people", data=payload, method="POST",
        headers={"Authorization": f"Bearer {CS_API_KEY}", "Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=20).read()).get("people", [])
    except Exception as e:
        print(f"    CS search error: {e}")
        return []

def cs_fetch_profile(profile_id):
    result = subprocess.run(["/root/.nanobot/tools/linkedin.sh", "fetch-profile", profile_id],
        capture_output=True, text=True, timeout=30)
    try:
        return json.loads(result.stdout)
    except Exception:
        return {}

def apollo_match(linkedin_url):
    try:
        payload = json.dumps({"linkedin_url": linkedin_url, "reveal_personal_emails": False}).encode()
        req = urllib.request.Request(f"{APOLLO_BASE}/people/match", data=payload, method="POST",
            headers={"Content-Type": "application/json", "x-api-key": APOLLO_API_KEY,
                     "User-Agent": "Mozilla/5.0"})
        data = json.loads(urllib.request.urlopen(req, timeout=15).read())
        person = data.get("person") or {}
        if not person:
            return None
        company_name = None
        job_title = person.get("title")
        for job in (person.get("employment_history") or []):
            if job.get("current"):
                company_name = job.get("organization_name")
                # Only trust current job if it also has a title
                if not job.get("title"):
                    company_name = None
                break
        if not company_name:
            org = person.get("organization") or {}
            company_name = org.get("name")
        return {
            "company_name": company_name,
            "title": job_title,
            "city": person.get("city"),
            "email": person.get("email"),
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

def name_first_match(fetched_first, expected_first):
    a, b = fetched_first.lower().strip(), expected_first.lower().strip()
    return a == b or a.startswith(b) or b.startswith(a)

# ── Load data ────────────────────────────────────────────────────────────────
people   = twenty("GET", "/rest/people?paging[first]=200").get("data", {}).get("people", [])
all_cos  = twenty("GET", "/rest/companies?paging[first]=200").get("data", {}).get("companies", [])
cos_by_id = {c["id"]: c["name"] for c in all_cos}

print(f"Processing {len(people)} contacts...\n")

for person in sorted(people, key=lambda x: (x.get("name") or {}).get("firstName", "")):
    n = person.get("name") or {}
    first = n.get("firstName", "").strip()
    last  = n.get("lastName", "").strip()
    full_name = f"{first} {last}".strip()

    li        = person.get("linkedinLink") or {}
    primary   = li.get("primaryLinkUrl", "")
    secondary = li.get("secondaryLinks") or []
    person_id = person["id"]

    is_acoaa  = "ACoA" in primary
    print(f"\n{'─'*60}")
    print(f"{full_name} | {'ACoAAA' if is_acoaa else 'vanity'}: {primary.split('/in/')[-1][:45]}")

    resolved_url = primary  # may be updated below

    # ── Step 1: resolve ACoAAA → vanity ──────────────────────────────────────
    if is_acoaa:
        acoaa_id = primary.split("/in/", 1)[1].rstrip("/")

        # Strategy A: search by name, match on profileUrn
        print(f"  Searching CS by name: {full_name!r}")
        results = cs_search(full_name)
        matched_result = None
        for r in results:
            urn = r.get("profileUrn", "")
            # profileUrn format: "urn:li:fsd_profile:ACoAAAN2dEo..."
            # Extract the ACoAAA part from the URN
            urn_id = urn.split("fsd_profile:", 1)[-1] if "fsd_profile:" in urn else ""
            if acoaa_id and urn_id and acoaa_id in urn_id:
                matched_result = r
                break

        if matched_result:
            vanity_slug = matched_result.get("profileId", "")
            vanity_url  = f"https://www.linkedin.com/in/{vanity_slug}"
            print(f"  ✓ URN-matched vanity: {vanity_url}")
            resolved_url = vanity_url
        else:
            # Strategy B: fetch-profile (ConnectSafely) with strict name check
            print(f"  No URN match — trying fetch-profile")
            prof = cs_fetch_profile(acoaa_id)
            if prof.get("success"):
                p = prof.get("profile", {})
                public_id    = p.get("publicIdentifier", "")
                fetched_first = p.get("firstName", "")
                if public_id and name_first_match(fetched_first, first):
                    vanity_url = f"https://www.linkedin.com/in/{public_id}"
                    print(f"  ✓ fetch-profile vanity: {vanity_url}")
                    resolved_url = vanity_url
                else:
                    print(f"  ✗ fetch-profile name mismatch ({fetched_first!r} vs {first!r})")
            else:
                print(f"  ✗ fetch-profile failed")

        # Update CRM if we resolved to vanity
        if resolved_url != primary:
            already_secondary = any(acoaa_id in (s.get("url","")) for s in secondary)
            new_secondary = secondary if already_secondary else [
                {"url": primary, "label": "LinkedIn (internal)"}
            ] + secondary
            twenty("PATCH", f"/rest/people/{person_id}", {
                "linkedinLink": {
                    "primaryLinkUrl": resolved_url,
                    "primaryLinkLabel": "LinkedIn",
                    "secondaryLinks": new_secondary,
                }
            })
            print(f"  → Updated primary URL to vanity")
        else:
            print(f"  → Keeping ACoAAA (could not resolve)")

    # ── Step 2: Apollo enrichment ─────────────────────────────────────────────
    if "ACoA" not in resolved_url:
        apollo = apollo_match(resolved_url)
        if apollo:
            co       = apollo.get("company_name")
            title    = apollo.get("title")
            city     = apollo.get("city")
            email    = apollo.get("email")
            print(f"  Apollo: {title} @ {co} [{city}] email={'yes' if email else 'no'}")

            updates = {}
            if title and title != (person.get("jobTitle") or ""):
                updates["jobTitle"] = title
            if city and not (person.get("city") or ""):
                updates["city"] = city
            if email and not ((person.get("emails") or {}).get("primaryEmail") or ""):
                updates["emails"] = {"primaryEmail": email, "additionalEmails": []}
            if updates:
                twenty("PATCH", f"/rest/people/{person_id}", updates)
                print(f"  Updated: {list(updates.keys())}")

            current_co_id   = person.get("companyId")
            current_co_name = cos_by_id.get(current_co_id, "") if current_co_id else ""
            if co and co.lower() != current_co_name.lower():
                co_id, created = find_or_create_company(co, all_cos)
                if co_id:
                    if created:
                        all_cos.append({"id": co_id, "name": co})
                        cos_by_id[co_id] = co
                    twenty("PATCH", f"/rest/people/{person_id}", {"companyId": co_id})
                    print(f"  {'Created+linked' if created else 'Linked'} company: {co}")
            elif co:
                print(f"  Company unchanged: {co}")
        else:
            print(f"  Apollo: no match")
    else:
        print(f"  Skipping Apollo (still ACoAAA)")

print(f"\n{'═'*60}")
print("Done. Final state:")
people2  = twenty("GET", "/rest/people?paging[first]=200").get("data", {}).get("people", [])
all_cos2 = twenty("GET", "/rest/companies?paging[first]=200").get("data", {}).get("companies", [])
cos_by_id2 = {c["id"]: c["name"] for c in all_cos2}
print(f"{'Name':28s} | {'Company':28s} | URL type")
print("─"*72)
for p in sorted(people2, key=lambda x: (x.get("name") or {}).get("firstName", "")):
    n = p.get("name") or {}
    fn, ln = n.get("firstName",""), n.get("lastName","")
    cid = p.get("companyId")
    co  = cos_by_id2.get(cid, "—") if cid else "—"
    url = (p.get("linkedinLink") or {}).get("primaryLinkUrl","")
    url_type = "vanity" if url and "ACoA" not in url else "ACoAAA"
    print(f"{fn+' '+ln:28s} | {co:28s} | {url_type}")
