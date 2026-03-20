import json, urllib.request, sys

api_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzczMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"

# Test 1: basic query
q1 = '{ people(first: 3) { edges { node { id name { firstName lastName } } } } }'
req = urllib.request.Request(
    "http://localhost:3000/graphql",
    data=json.dumps({"query": q1}).encode(),
    headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
)
try:
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    print("TEST 1 - Basic query:")
    print(json.dumps(data, indent=2)[:500])
except Exception as e:
    print(f"TEST 1 ERROR: {e}")

# Test 2: search for Jenn
q2 = '{ people(filter: { or: [ { name: { firstName: { ilike: "%%Jenn%%" } } }, { name: { lastName: { ilike: "%%Jenn%%" } } } ] }) { edges { node { id name { firstName lastName } } } } }'
req2 = urllib.request.Request(
    "http://localhost:3000/graphql",
    data=json.dumps({"query": q2}).encode(),
    headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
)
try:
    resp2 = urllib.request.urlopen(req2)
    data2 = json.loads(resp2.read())
    print("\nTEST 2 - Search 'Jenn':")
    print(json.dumps(data2, indent=2)[:500])
except Exception as e:
    print(f"TEST 2 ERROR: {e}")

# Test 3: search for Magee
q3 = '{ people(filter: { name: { lastName: { ilike: "%%Magee%%" } } }) { edges { node { id name { firstName lastName } } } } }'
req3 = urllib.request.Request(
    "http://localhost:3000/graphql",
    data=json.dumps({"query": q3}).encode(),
    headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
)
try:
    resp3 = urllib.request.urlopen(req3)
    data3 = json.loads(resp3.read())
    print("\nTEST 3 - Search 'Magee':")
    print(json.dumps(data3, indent=2)[:500])
except Exception as e:
    print(f"TEST 3 ERROR: {e}")
