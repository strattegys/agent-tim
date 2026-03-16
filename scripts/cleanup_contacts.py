#!/usr/bin/env python3
"""Clean up malformed and near-duplicate contacts. Dry-run by default; pass --delete to actually delete."""
import json, urllib.request, sys
from collections import defaultdict

DRY_RUN = "--delete" not in sys.argv

with open("/root/.nanobot/tools/twenty_crm_enhanced.sh") as f:
    content = f.read()
import re
match = re.search(r'^API_KEY="([^"]+)"', content, re.MULTILINE)
API_KEY = match.group(1)
BASE = "http://localhost:3000"

def call(method, path, payload=None):
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method,
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req).read())
    except Exception as e:
        print(f"  ERROR: {e}")
        return {}

people = call("GET", "/rest/people?paging[first]=500&orderBy[createdAt]=AscNullsFirst").get("data", {}).get("people", [])
print(f"Total people: {len(people)}\n")

to_delete = []  # list of (id, reason)

by_first = defaultdict(list)
for p in people:
    n = p.get("name") or {}
    first = (n.get("firstName") or "").strip()
    last = (n.get("lastName") or "").strip()
    by_first[first.lower()].append((p["id"], first, last, p.get("createdAt", "")))

# 1. Contacts where firstName == "LinkedIn" (malformed parse)
print("=== Malformed 'LinkedIn' contacts ===")
for pid, first, last, created in by_first.get("linkedin", []):
    reason = f"Malformed: firstName='LinkedIn', lastName='{last}'"
    print(f"  DELETE {pid[:8]} — {reason}")
    to_delete.append((pid, reason))

# 2. Contacts with no last name that likely match a full-name contact
print("\n=== No-last-name contacts with a possible full-name match ===")
for first_lower, entries in sorted(by_first.items()):
    no_last = [(pid, f, l, c) for pid, f, l, c in entries if not l]
    with_last = [(pid, f, l, c) for pid, f, l, c in entries if l]
    if no_last and with_last:
        for pid, f, l, c in no_last:
            best_match = sorted(with_last, key=lambda x: x[3])[0]
            reason = f"No last name; matches '{best_match[1]} {best_match[2]}' ({best_match[0][:8]})"
            print(f"  DELETE {pid[:8]} '{f}' — {reason}")
            to_delete.append((pid, reason))

# 3. Standard exact-name duplicates (keep oldest)
print("\n=== Standard duplicates (same first+last, keep oldest) ===")
by_full = defaultdict(list)
for p in people:
    n = p.get("name") or {}
    first = (n.get("firstName") or "").lower().strip()
    last = (n.get("lastName") or "").lower().strip()
    by_full[(first, last)].append(p)

already_flagged = {pid for pid, _ in to_delete}
for (first, last), dupes in by_full.items():
    if len(dupes) > 1:
        sorted_dupes = sorted(dupes, key=lambda x: x.get("createdAt", ""))
        for dup in sorted_dupes[1:]:
            if dup["id"] not in already_flagged:
                reason = f"Dup of '{first} {last}', keeping {sorted_dupes[0]['id'][:8]}"
                print(f"  DELETE {dup['id'][:8]} '{first} {last}' — {reason}")
                to_delete.append((dup["id"], reason))

print(f"\n{'DRY RUN — ' if DRY_RUN else ''}Total to delete: {len(to_delete)}")
if not DRY_RUN:
    for pid, reason in to_delete:
        call("DELETE", f"/rest/people/{pid}")
        print(f"  Deleted {pid[:8]} ({reason[:60]})")
    print("Done")
else:
    print("Run with --delete to actually remove these.")
