#!/usr/bin/env python3
"""
Patch linkedin_extractor.py:
  - Add cs_search_people() using ConnectSafely search/people endpoint
  - Rewrite resolve_vanity_url() to use URN-match search (Strategy A)
    then fetch-profile (Strategy B) as fallback
  - Simplify enrich_contact() to call resolve_vanity_url() once up front,
    then use Apollo with the resolved vanity URL
"""

with open("/root/.nanobot/tools/linkedin_extractor.py") as f:
    content = f.read()

# ── 1. Replace resolve_vanity_url() ──────────────────────────────────────────

OLD_RESOLVE = '''def resolve_vanity_url(participant):
    """
    Attempt to resolve an ACoAAA internal LinkedIn URN to a vanity URL
    by calling fetch-profile and validating the returned name matches.

    Returns the canonical vanity URL (https://linkedin.com/in/slug) if resolved,
    or the original URL if not.
    """
    linkedin_url = participant.get("profileUrl") or ""
    participant_name = participant.get("name") or ""
    if not linkedin_url or "/in/" not in linkedin_url:
        return linkedin_url

    profile_id = linkedin_url.split("/in/", 1)[1].rstrip("/")

    # Already a vanity slug — nothing to resolve
    if not profile_id.startswith("ACoA"):
        return linkedin_url

    print(f"    Resolving ACoAAA to vanity URL...")
    try:
        result = subprocess.run(
            ["bash", LINKEDIN_TOOL, "fetch-profile", profile_id],
            capture_output=True, text=True, timeout=30
        )
        prof = json.loads(result.stdout)
        if not prof.get("success"):
            return linkedin_url

        p = prof.get("profile", {})
        public_id = p.get("publicIdentifier") or ""
        fetched_first = p.get("firstName") or ""

        # Validate: fetched first name must match participant's first name
        # This guards against ConnectSafely resolving the wrong person
        expected_first = participant_name.split()[0] if participant_name else ""
        if public_id and (lambda a,b: a==b or a.startswith(b) or b.startswith(a))(fetched_first.lower(), expected_first.lower()):
            vanity_url = f"https://www.linkedin.com/in/{public_id}"
            print(f"    Resolved: {vanity_url}")
            return vanity_url
        else:
            print(f"    Name mismatch ({fetched_first!r} vs {expected_first!r}) — keeping ACoAAA URL")
            return linkedin_url
    except Exception as e:
        print(f"    Could not resolve vanity URL: {e}")
        return linkedin_url'''

NEW_RESOLVE = '''def cs_search_people(name, limit=10):
    """Search ConnectSafely for LinkedIn people by name. Returns list of result dicts."""
    try:
        payload = json.dumps({
            "accountId": CONNECTSAFELY_ACCOUNT_ID,
            "keywords": name,
            "limit": limit,
        }).encode()
        req = urllib.request.Request(
            f"{CS_BASE}/linkedin/search/people",
            data=payload,
            method="POST",
            headers={
                "Authorization": f"Bearer {CONNECTSAFELY_API_KEY}",
                "Content-Type": "application/json",
            },
        )
        return json.loads(urllib.request.urlopen(req, timeout=20).read()).get("people", [])
    except Exception as e:
        print(f"    CS search error: {e}")
        return []


def resolve_vanity_url(participant):
    """
    Resolve an ACoAAA internal LinkedIn URN to a public vanity URL.

    Strategy A — URN search (most reliable):
      Search ConnectSafely by the contact's name, then match a result whose
      profileUrn contains the stored ACoAAA ID exactly. Returns that result's
      profileId as the vanity slug. No false-positive risk.

    Strategy B — fetch-profile fallback:
      Call ConnectSafely fetch-profile on the ACoAAA ID and validate that the
      returned firstName matches the participant's first name. Guards against the
      ~70% wrong-person rate ConnectSafely has for ACoAAA lookups.

    Returns the canonical vanity URL (https://linkedin.com/in/slug) if resolved,
    or the original ACoAAA URL if neither strategy succeeds.
    """
    linkedin_url = participant.get("profileUrl") or ""
    participant_name = participant.get("name") or ""
    if not linkedin_url or "/in/" not in linkedin_url:
        return linkedin_url

    acoaa_id = linkedin_url.split("/in/", 1)[1].rstrip("/")

    # Already a vanity slug — nothing to do
    if not acoaa_id.startswith("ACoA"):
        return linkedin_url

    # ── Strategy A: search by name, match on profileUrn ──────────────────────
    print(f"    Resolving ACoAAA → searching by name: {participant_name!r}")
    results = cs_search_people(participant_name)
    for r in results:
        urn = r.get("profileUrn", "")
        # profileUrn format: "urn:li:fsd_profile:ACoAAA..."
        urn_id = urn.split("fsd_profile:", 1)[-1] if "fsd_profile:" in urn else ""
        if acoaa_id and urn_id and acoaa_id in urn_id:
            vanity_slug = r.get("profileId", "")
            if vanity_slug:
                vanity_url = f"https://www.linkedin.com/in/{vanity_slug}"
                print(f"    Strategy A resolved: {vanity_url}")
                return vanity_url

    # ── Strategy B: fetch-profile with name validation ────────────────────────
    print(f"    Strategy A no URN match — trying fetch-profile")
    try:
        result = subprocess.run(
            ["bash", LINKEDIN_TOOL, "fetch-profile", acoaa_id],
            capture_output=True, text=True, timeout=30
        )
        prof = json.loads(result.stdout)
        if prof.get("success"):
            p = prof.get("profile", {})
            public_id     = p.get("publicIdentifier") or ""
            fetched_first = p.get("firstName") or ""
            expected_first = participant_name.split()[0] if participant_name else ""
            fn_match = (lambda a, b: a == b or a.startswith(b) or b.startswith(a))(
                fetched_first.lower(), expected_first.lower()
            )
            if public_id and fn_match:
                vanity_url = f"https://www.linkedin.com/in/{public_id}"
                print(f"    Strategy B resolved: {vanity_url}")
                return vanity_url
            else:
                print(f"    Strategy B name mismatch ({fetched_first!r} vs {expected_first!r})")
    except Exception as e:
        print(f"    Strategy B error: {e}")

    print(f"    Could not resolve — keeping ACoAAA")
    return linkedin_url'''

assert OLD_RESOLVE in content, "resolve_vanity_url not found"
content = content.replace(OLD_RESOLVE, NEW_RESOLVE)
print("✓ Replaced resolve_vanity_url() with two-strategy version + cs_search_people()")

# ── 2. Rewrite enrich_contact() to use resolve_vanity_url() up front ─────────
# The current enrich_contact does fetch-profile inline again for both
# location AND vanity resolution. Simplify: resolve vanity first (using
# the improved function), then get location from Apollo, skip duplicate fetch.

OLD_ENRICH_HEADER = '''def enrich_contact(contact_id, participant):
    """
    Enrich a contact using conversation participant data (always available)
    plus fetch-profile for location and vanity URL resolution.

    participant dict from ConnectSafely conversations API:
      { name, headline, profileUrl, profilePicture, ... }
    """
    headline = participant.get("headline") or ""
    linkedin_url = participant.get("profileUrl") or ""
    city = ""

    # Always attempt fetch-profile to get location and resolve vanity URL
    if linkedin_url and "/in/" in linkedin_url:
        profile_id = linkedin_url.split("/in/", 1)[1].rstrip("/")
        print(f"    Fetching profile: {profile_id[:40]}...")
        try:
            result = subprocess.run(
                ["bash", LINKEDIN_TOOL, "fetch-profile", profile_id],
                capture_output=True, text=True, timeout=30
            )
            prof = json.loads(result.stdout)
            if prof.get("success"):
                p = prof.get("profile", {})
                headline = headline or p.get("headline") or ""
                geo = p.get("geoLocation") or {}
                city = geo.get("city") or geo.get("fullLocation") or ""

                # Resolve ACoAAA to vanity URL (with name validation)
                public_id = p.get("publicIdentifier") or ""
                if public_id and profile_id.startswith("ACoA"):
                    participant_name = participant.get("name") or ""
                    fetched_first = p.get("firstName") or ""
                    expected_first = participant_name.split()[0] if participant_name else ""
                    if (lambda a,b: a==b or a.startswith(b) or b.startswith(a))(fetched_first.lower(), expected_first.lower()):
                        vanity_url = f"https://www.linkedin.com/in/{public_id}"
                        print(f"    Resolved vanity URL: {vanity_url}")
                        # Upgrade stored LinkedIn URL to vanity format
                        twenty("PATCH", f"/rest/people/{contact_id}", {
                            "linkedinLink": {
                                "primaryLinkUrl": vanity_url,
                                "primaryLinkLabel": "LinkedIn",
                                "secondaryLinks": [
                                    {"url": linkedin_url, "label": "LinkedIn (internal)"}
                                ],
                            }
                        })
                        linkedin_url = vanity_url  # use vanity in note too
                    else:
                        print(f"    Name mismatch ({fetched_first!r} vs {expected_first!r}) — keeping ACoAAA")
        except Exception as e:
            print(f"    Profile fetch error: {e}")

    if not headline:
        print(f"    No headline in participant data — skipping enrichment")
        return'''

NEW_ENRICH_HEADER = '''def enrich_contact(contact_id, participant):
    """
    Enrich a contact using Apollo + ConnectSafely data.

    Flow:
      1. Resolve ACoAAA URL → vanity (search URN-match, then fetch-profile fallback)
      2. Store vanity as primaryLinkUrl in CRM (ACoAAA moves to secondaryLinks)
      3. Call Apollo with vanity URL → company, title, city, email
      4. Headline parsing fallback for company if Apollo has no match
      5. Write LinkedIn Profile Summary note
    """
    headline     = participant.get("headline") or ""
    linkedin_url = participant.get("profileUrl") or ""

    # ── Step 1: resolve ACoAAA → vanity URL ──────────────────────────────────
    if linkedin_url and "/in/" in linkedin_url and "ACoA" in linkedin_url:
        resolved = resolve_vanity_url(participant)
        if resolved != linkedin_url:
            # Update CRM: vanity as primary, ACoAAA as secondary
            twenty("PATCH", f"/rest/people/{contact_id}", {
                "linkedinLink": {
                    "primaryLinkUrl": resolved,
                    "primaryLinkLabel": "LinkedIn",
                    "secondaryLinks": [
                        {"url": linkedin_url, "label": "LinkedIn (internal)"}
                    ],
                }
            })
            linkedin_url = resolved

    if not headline:
        print(f"    No headline — skipping enrichment")
        return'''

assert OLD_ENRICH_HEADER in content, "enrich_contact header not found"
content = content.replace(OLD_ENRICH_HEADER, NEW_ENRICH_HEADER)
print("✓ Rewrote enrich_contact() header (vanity resolution up front)")

# ── 3. Fix apollo_enrich to skip company when current job has no title ────────
# (prevents stale "Sports Research"-style entries with current=True but no title)
OLD_APOLLO_COMPANY = '''        # Current company from employment_history (current=True), then org object
        company_name = None
        for job in person.get("employment_history") or []:
            if job.get("current"):
                company_name = job.get("organization_name")
                break
        if not company_name:
            org = person.get("organization") or {}
            company_name = org.get("name")'''

NEW_APOLLO_COMPANY = '''        # Current company: prefer employment_history current=True WITH a title,
        # fall back to org object. Skips current entries with no title (stale data).
        company_name = None
        for job in person.get("employment_history") or []:
            if job.get("current"):
                if job.get("title") or job.get("organization_name"):
                    # Only trust if job has a title (guards against stale blanks)
                    if job.get("title"):
                        company_name = job.get("organization_name")
                break
        if not company_name:
            org = person.get("organization") or {}
            company_name = org.get("name")'''

assert OLD_APOLLO_COMPANY in content, "apollo_enrich company block not found"
content = content.replace(OLD_APOLLO_COMPANY, NEW_APOLLO_COMPANY)
print("✓ Fixed apollo_enrich() to skip titleless current jobs (stale data guard)")

with open("/root/.nanobot/tools/linkedin_extractor.py", "w") as f:
    f.write(content)
print("✓ File written successfully")

# Quick sanity check
with open("/root/.nanobot/tools/linkedin_extractor.py") as f:
    final = f.read()
for fn in ["cs_search_people", "resolve_vanity_url", "apollo_enrich", "enrich_contact"]:
    count = final.count(f"def {fn}")
    print(f"  def {fn}: {count} definition(s)")
