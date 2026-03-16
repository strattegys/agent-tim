import json, urllib.request, re

with open("/root/.nanobot/tools/twenty_crm_enhanced.sh") as f:
    content = f.read()
match = re.search(r'^API_KEY="([^"]+)"', content, re.MULTILINE)
API_KEY = match.group(1)
BASE = "http://localhost:3000"

req = urllib.request.Request(
    f"{BASE}/rest/people?paging[first]=500&orderBy[name][firstName]=AscNullsFirst",
    headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"})
people = json.loads(urllib.request.urlopen(req).read()).get("data", {}).get("people", [])
print(f"Total: {len(people)}")
for p in sorted(people, key=lambda x: ((x.get("name") or {}).get("firstName",""), (x.get("name") or {}).get("lastName",""))):
    n = p.get("name") or {}
    print(f"  {n.get('firstName',''):20s} {n.get('lastName','')}")
