#!/usr/bin/env python3
"""Delete duplicate contacts created during test runs (keep oldest)."""
import json, urllib.request
from collections import defaultdict

API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzczMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
BASE = "http://localhost:3000"

def call(method, path, payload=None):
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method,
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read())

people = call("GET", "/rest/people?paging[first]=500&orderBy[createdAt]=AscNullsFirst").get("data", {}).get("people", [])
print(f"Total people: {len(people)}")

by_name = defaultdict(list)
for person in people:
    n = person.get("name") or {}
    first = n.get("firstName", "").lower().strip()
    last = n.get("lastName", "").lower().strip()
    by_name[(first, last)].append(person)

to_delete = []
for (first, last), dupes in by_name.items():
    if len(dupes) > 1:
        sorted_dupes = sorted(dupes, key=lambda x: x.get("createdAt", ""))
        keep_id = sorted_dupes[0]["id"]
        for dup in sorted_dupes[1:]:
            to_delete.append(dup["id"])
        print(f"  Dup: '{first} {last}' x{len(dupes)}, keeping {keep_id[:8]}")

print(f"\nDeleting {len(to_delete)} duplicates...")
for pid in to_delete:
    call("DELETE", f"/rest/people/{pid}")
    print(f"  Deleted {pid[:8]}")
print("Done")
