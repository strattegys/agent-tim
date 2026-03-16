#!/usr/bin/env python3
"""
LinkedIn Message Extractor for Nanobot Tim
Fetches LinkedIn conversations, creates/updates Twenty CRM contacts,
logs messages as notes, and sends Telegram alerts for inbound messages.
"""

import json
import os
import sys
import subprocess
import datetime
import urllib.request
import urllib.error
import tempfile

# ── Config ──────────────────────────────────────────────────────────────────
CONNECTSAFELY_API_KEY = "1df1fdda-51e5-46c1-8a97-99dde05a11d1"
CONNECTSAFELY_ACCOUNT_ID = "699fbf3eb09b5425c73d4b81"
CS_BASE = "https://api.connectsafely.ai"

TWENTY_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzczMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
TWENTY_BASE = "http://localhost:3000"

TELEGRAM_TOKEN = "8784616714:AAEAeJJ25_ypScrEJvEl2QFwgHC51-7HATw"
GOVIND_CHAT_ID = "5289013326"

STATE_FILE = "/root/.nanobot/linkedin_message_state.json"
CRM_TOOL = "/root/.nanobot/tools/twenty_crm_enhanced.sh"
LINKEDIN_TOOL = "/root/.nanobot/tools/linkedin.sh"
ALERT_LOG = "/root/.nanobot/linkedin_alerts.log"

ENRICHMENT_MAX_AGE_DAYS = 30
MAX_STORED_IDS = 2000  # cap state file size


# ── State ────────────────────────────────────────────────────────────────────

def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                data = json.load(f)
            # Migrate old cursor-based state
            if "processed_ids" not in data:
                data = {"processed_ids": [], "last_run": None}
            return data
        except Exception:
            pass
    return {"processed_ids": [], "last_run": None}


def save_state(state):
    # Keep only the most recent MAX_STORED_IDS to prevent unbounded growth
    ids = state.get("processed_ids", [])
    if len(ids) > MAX_STORED_IDS:
        ids = ids[-MAX_STORED_IDS:]
    state["processed_ids"] = ids
    state["last_run"] = datetime.datetime.now().isoformat()
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def cs_get(path, params=None):
    url = f"{CS_BASE}{path}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {CONNECTSAFELY_API_KEY}",
        "Content-Type": "application/json",
    })
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read())


def twenty(method, endpoint, payload=None):
    url = f"{TWENTY_BASE}{endpoint}"
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {TWENTY_API_KEY}",
        "Content-Type": "application/json",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        return {"error": str(e), "body": body}
    except Exception as e:
        return {"error": str(e)}


# ── LinkedIn URL normalisation ────────────────────────────────────────────────

def linkedin_path(url):
    """
    Extract the /in/SLUG portion for comparison.
    Handles both vanity slugs and ACoAAA... internal IDs.
    Returns normalised lowercase string or None.
    """
    if not url:
        return None
    url = url.strip().rstrip("/")
    if "/in/" not in url:
        return None
    return "/in/" + url.split("/in/", 1)[1].rstrip("/").lower()


def linkedin_urls_match(url_a, url_b):
    """True if both URLs point to the same LinkedIn profile path."""
    pa, pb = linkedin_path(url_a), linkedin_path(url_b)
    return pa is not None and pb is not None and pa == pb


# ── Contact cache & matching ──────────────────────────────────────────────────

_contact_cache = None


def load_contacts():
    """Load all people from Twenty CRM once per run."""
    global _contact_cache
    if _contact_cache is not None:
        return _contact_cache
    print("  Loading contacts from CRM...")
    resp = twenty("GET", "/rest/people?paging[first]=500&orderBy[createdAt]=AscNullsFirst")
    people = resp.get("data", {}).get("people", [])
    _contact_cache = people
    print(f"  Loaded {len(people)} contacts")
    return people


# Professional suffixes that appear in LinkedIn names but shouldn't affect matching
_NAME_SUFFIXES = {
    "emba", "mba", "phd", "ph.d", "md", "m.d", "jd", "cpa", "cfa", "pmp",
    "jr", "sr", "ii", "iii", "iv", "esq", "rn", "pe", "dds", "dvm",
}


def normalize_name(name):
    """
    Lowercase, strip commas, and remove professional suffixes.
    'Juli Cooper, EMBA' -> 'juli cooper'
    'John Smith Jr.' -> 'john smith'
    """
    tokens = [t.strip().rstrip(".,") for t in name.replace(",", " ").split()]
    tokens = [t for t in tokens if t.lower() not in _NAME_SUFFIXES and t]
    return " ".join(tokens).lower()


def find_contact_by_linkedin(linkedin_url):
    """
    Find a contact matching by LinkedIn URL.
    Checks primary URL and also secondaryLinks for cross-format matches
    (vanity slug vs ACoAAA internal URN).
    """
    if not linkedin_url:
        return None
    for p in load_contacts():
        li = p.get("linkedinLink") or {}
        primary = li.get("primaryLinkUrl", "")
        if linkedin_urls_match(primary, linkedin_url):
            return p
        # Also check secondary links (where we store alternate-format URLs)
        for sec in li.get("secondaryLinks", []):
            if linkedin_urls_match(sec.get("url", ""), linkedin_url):
                return p
    return None


def find_contact_by_name(full_name):
    """
    Find by name with suffix normalization.
    'Juli Cooper, EMBA' matches a contact stored as 'Juli Cooper'.
    """
    needle = normalize_name(full_name)
    for p in load_contacts():
        n = p.get("name") or {}
        stored = normalize_name(
            (n.get("firstName") or "") + " " + (n.get("lastName") or "")
        )
        if stored == needle:
            return p
    return None


def store_secondary_linkedin(contact_id, alt_url):
    """
    When we matched by name but the API URL differs from what's stored,
    add the API URL as a secondary LinkedIn link so future runs match by URL.
    Only stores ACoAAA URLs (internal URNs) as secondary — vanity slugs
    should always be the primary.
    """
    if not alt_url or "ACoA" not in alt_url:
        return  # Only worth storing the internal URN as secondary
    resp = twenty("GET", f"/rest/people/{contact_id}")
    contact = resp.get("data", {}).get("person", {})
    li = contact.get("linkedinLink") or {}
    existing_secondary = li.get("secondaryLinks", [])
    # Check if already stored
    for sec in existing_secondary:
        if linkedin_urls_match(sec.get("url", ""), alt_url):
            return
    existing_secondary.append({"url": alt_url, "label": "LinkedIn (internal)"})
    twenty("PATCH", f"/rest/people/{contact_id}", {
        "linkedinLink": {
            "primaryLinkUrl": li.get("primaryLinkUrl", ""),
            "primaryLinkLabel": li.get("primaryLinkLabel", "LinkedIn"),
            "secondaryLinks": existing_secondary,
        }
    })


def create_contact(first_name, last_name, linkedin_url=None):
    """Create a new contact in Twenty CRM and add to local cache."""
    payload = {"name": {"firstName": first_name, "lastName": last_name or ""}}
    if linkedin_url:
        payload["linkedinLink"] = {
            "primaryLinkUrl": linkedin_url,
            "primaryLinkLabel": "LinkedIn",
        }
    resp = twenty("POST", "/rest/people", payload)
    contact = resp.get("data", {}).get("createPerson", {})
    if contact.get("id"):
        _contact_cache.append(contact)  # keep cache in sync
        return contact
    print(f"  ERROR creating contact: {resp.get('error') or resp.get('body', '')}")
    return None


# ── Profile enrichment ────────────────────────────────────────────────────────

def needs_enrichment(contact):
    """True if contact was never enriched or last updated more than 30 days ago."""
    updated_at = contact.get("updatedAt")
    if not updated_at:
        return True
    try:
        updated = datetime.datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        age = datetime.datetime.now(datetime.timezone.utc) - updated
        return age.days >= ENRICHMENT_MAX_AGE_DAYS
    except Exception:
        return True


def try_extract_company_from_headline(headline):
    """
    Best-effort company extraction from headline strings like:
      'CTO at Canvas Custom Indexing'
      'VP Sales @ Acme Corp'
      'Growth Marketing | Startup Vet - 2x Exits'
    Returns company name string or None.
    """
    if not headline:
        return None
    for sep in [" at ", " @ "]:
        idx = headline.lower().find(sep.lower())
        if idx != -1:
            candidate = headline[idx + len(sep):].strip().split("|")[0].strip()
            if 3 < len(candidate) < 80:
                return candidate
    return None


def resolve_vanity_url(participant):
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
        if public_id and fetched_first.lower() == expected_first.lower():
            vanity_url = f"https://www.linkedin.com/in/{public_id}"
            print(f"    Resolved: {vanity_url}")
            return vanity_url
        else:
            print(f"    Name mismatch ({fetched_first!r} vs {expected_first!r}) — keeping ACoAAA URL")
            return linkedin_url
    except Exception as e:
        print(f"    Could not resolve vanity URL: {e}")
        return linkedin_url


def enrich_contact(contact_id, participant):
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
                    if fetched_first.lower() == expected_first.lower():
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
        return

    # Update contact fields
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
            companies = json.loads(co_resp.stdout)
            if companies:
                company_id = companies[0]["id"]
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
    note_lines = ["## LinkedIn Profile Summary\n"]
    note_lines.append(f"**Headline:** {headline}")
    if city:
        note_lines.append(f"**Location:** {city}")
    if company_name:
        note_lines.append(f"**Company (parsed from headline):** {company_name}")
    if linkedin_url:
        note_lines.append(f"**LinkedIn:** {linkedin_url}")
    note_lines.append(f"\n*Enriched: {datetime.date.today().isoformat()}*")

    _write_note("LinkedIn Profile Summary", "\n".join(note_lines), "person", contact_id)
    print(f"    Enrichment done: {headline[:60]}")


# ── Note creation ─────────────────────────────────────────────────────────────

def _write_note(title, content, target_type, target_id):
    """Use write-note from twenty_crm_enhanced.sh — handles special chars safely."""
    result = subprocess.run(
        ["bash", CRM_TOOL, "write-note", title, content, target_type, target_id],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        print(f"    NOTE ERROR (rc={result.returncode}): {result.stderr[:300]}")
        return False
    return True


def build_note_content(msg_type, person_label, message_text, sent_at, conv_id, linkedin_url):
    direction = "To" if ("Outbound" in msg_type or "Connection" in msg_type) else "From"
    lines = [
        message_text,
        "",
        f"**Type:** {msg_type}",
        f"**{direction}:** {person_label}",
        f"**Date:** {sent_at}",
        f"**Conversation ID:** {conv_id}",
    ]
    if linkedin_url:
        lines.append(f"**LinkedIn Profile:** {linkedin_url}")
    return "\n".join(lines)


# ── Telegram alert ────────────────────────────────────────────────────────────

def send_alert(message):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with open(ALERT_LOG, "a") as f:
            f.write(f"[{ts}] {message}\n")
    except Exception:
        pass
    try:
        subprocess.run([
            "curl", "-s", "-X", "POST",
            f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
            "-d", f"chat_id={GOVIND_CHAT_ID}",
            "-d", f"text=🔔 LinkedIn: {message[:1000]}",
            "-d", "parse_mode=Markdown",
        ], capture_output=True, timeout=10)
    except Exception:
        pass


# ── Main ──────────────────────────────────────────────────────────────────────

def is_govind(sender_name):
    return "Govind Davis" in (sender_name or "")


def format_pt_time(ms):
    try:
        utc = datetime.datetime.fromtimestamp(ms / 1000, tz=datetime.timezone.utc)
        pt = utc.astimezone(datetime.timezone(datetime.timedelta(hours=-7)))
        return pt.strftime("%Y-%m-%d %I:%M %p PT")
    except Exception:
        return "unknown time"


def process_conversation(conv, processed_ids):
    conv_id = conv.get("conversationId")
    participants = conv.get("participants", [])
    latest = conv.get("latestMessage", {})

    sender_name = latest.get("senderName", "Unknown")
    sender_url = latest.get("senderProfileUrl", "")
    message_text = latest.get("text", "") or ""
    sent_at_ms = latest.get("sentAt") or 0
    sent_at = (datetime.datetime.fromtimestamp(sent_at_ms / 1000).strftime("%Y-%m-%d %H:%M:%S")
               if sent_at_ms else "unknown")

    participant = participants[0] if participants else {}
    participant_name = participant.get("name", "")
    participant_url = participant.get("profileUrl", "")

    # Connection request: LinkedIn API quirk — senderName == participantName for outbound requests
    is_connection = (
        len(participants) == 1 and
        sender_name.strip().lower() == participant_name.strip().lower()
    )
    outbound = is_govind(sender_name) or is_connection

    if outbound:
        recipient_name = participant_name
        recipient_url = participant_url
        msg_type = "LinkedIn Connection Request" if is_connection else "LinkedIn Outbound Message"

        if not recipient_name:
            print(f"  Skip outbound {conv_id[:24]}... — no recipient name")
            processed_ids.add(conv_id)
            return 0

        print(f"  {msg_type} → {recipient_name}")

        is_new = False
        matched_by_url = find_contact_by_linkedin(recipient_url)
        contact = matched_by_url or find_contact_by_name(recipient_name)
        if not contact:
            parts = recipient_name.split(" ", 1)
            contact = create_contact(parts[0], parts[1] if len(parts) > 1 else "", recipient_url)
            if not contact:
                processed_ids.add(conv_id)
                return 0
            is_new = True
            print(f"    Created: {recipient_name} ({contact['id']})")
        else:
            print(f"    Matched: {recipient_name} ({contact['id']})")
            # If matched by name (not URL), cross-link the alternate URL format
            if not matched_by_url and recipient_url:
                store_secondary_linkedin(contact["id"], recipient_url)

        contact_id = contact["id"]
        if (is_new or needs_enrichment(contact)) and participant:
            enrich_contact(contact_id, participant)

        _write_note(
            f"{msg_type} to {recipient_name}",
            build_note_content(msg_type, recipient_name, message_text, sent_at, conv_id, recipient_url),
            "person", contact_id
        )
        processed_ids.add(conv_id)
        return 0  # no Telegram alert for outbound

    else:
        print(f"  Inbound from {sender_name}")

        is_new = False
        matched_by_url = find_contact_by_linkedin(sender_url)
        contact = matched_by_url or find_contact_by_name(sender_name)
        if not contact:
            parts = sender_name.split(" ", 1)
            contact = create_contact(parts[0], parts[1] if len(parts) > 1 else "", sender_url)
            if not contact:
                processed_ids.add(conv_id)
                return 0
            is_new = True
            print(f"    Created: {sender_name} ({contact['id']})")
        else:
            print(f"    Matched: {sender_name} ({contact['id']})")
            # If matched by name (not URL), cross-link the alternate URL format
            if not matched_by_url and sender_url:
                store_secondary_linkedin(contact["id"], sender_url)

        contact_id = contact["id"]
        # participant[0] is always the other person — has headline, profileUrl, etc.
        if (is_new or needs_enrichment(contact)) and participant:
            enrich_contact(contact_id, participant)

        _write_note(
            f"LinkedIn Message from {sender_name}",
            build_note_content("LinkedIn Inbound Message", sender_name, message_text, sent_at, conv_id, sender_url),
            "person", contact_id
        )
        processed_ids.add(conv_id)

        send_alert(f"{format_pt_time(sent_at_ms)} — {sender_name}: {message_text[:400]}")
        return 1


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    print(f"LinkedIn Message Extractor — fetching {limit} conversations")

    state = load_state()
    processed_ids = set(state.get("processed_ids", []))
    print(f"State: {len(processed_ids)} already-processed IDs\n")

    try:
        data = cs_get("/linkedin/messaging/recent-messages", {"limit": limit})
    except Exception as e:
        print(f"API ERROR: {e}")
        send_alert(f"Failed to fetch LinkedIn messages: {e}")
        sys.exit(1)

    if not data.get("success"):
        msg = data.get("error", "unknown error")
        print(f"API returned failure: {msg}")
        send_alert(f"LinkedIn API failure: {msg}")
        sys.exit(1)

    conversations = data.get("conversations", [])
    print(f"Got {len(conversations)} conversations\n")

    new_inbound = 0
    skipped = 0

    for conv in conversations:
        conv_id = conv.get("conversationId")
        if conv_id in processed_ids:
            skipped += 1
            continue
        new_inbound += process_conversation(conv, processed_ids)

    print(f"\n{'─' * 50}")
    print(f"Done: {new_inbound} new inbound alerts, {skipped} skipped (already processed)")

    state["processed_ids"] = list(processed_ids)
    save_state(state)
    print(f"State saved ({len(processed_ids)} IDs)")


if __name__ == "__main__":
    main()
