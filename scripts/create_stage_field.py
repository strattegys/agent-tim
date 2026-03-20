#!/usr/bin/env python3
"""Create Stage SELECT field on Person object in Twenty CRM."""
import urllib.request
import json

API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhNGQ4OTI0MC02ZjFiLTQwNTgtYmQxMC00MjAxZmRlZTE4ZTIiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiYTRkODkyNDAtNmYxYi00MDU4LWJkMTAtNDIwMWZkZWUxOGUyIiwiaWF0IjoxNzczMzc4NjQ5LCJleHAiOjQ5MjY5ODIyNDksImp0aSI6ImMwNzkyNjlmLWQyYzItNDI1ZS04Yzc4LWUxNGNiMTIzZTFhOSJ9.yphvOpXYUn87EQukYwFU0IjssXv-3AWkQOSgNmu4SXk"
URL = "http://localhost:3000/metadata"
PERSON_OBJECT_ID = "564b11dd-2c15-439e-a6c9-9a51999fc1af"

mutation = """
mutation {
  createOneField(input: {
    field: {
      objectMetadataId: "%s"
      name: "stage"
      label: "Stage"
      type: SELECT
      description: "Campaign outreach stage"
      options: [
        {label: "Target", value: "TARGET", color: "gray", position: 0}
        {label: "Initiated", value: "INITIATED", color: "blue", position: 1}
        {label: "Accepted", value: "ACCEPTED", color: "turquoise", position: 2}
        {label: "Engaged", value: "ENGAGED", color: "yellow", position: 3}
        {label: "Prospect", value: "PROSPECT", color: "orange", position: 4}
        {label: "Converted", value: "CONVERTED", color: "green", position: 5}
        {label: "KIT", value: "KIT", color: "purple", position: 6}
        {label: "DNC", value: "DNC", color: "red", position: 7}
        {label: "Unqualified", value: "UNQUALIFIED", color: "gray", position: 8}
      ]
    }
  }) {
    id
    name
    label
    type
  }
}
""" % PERSON_OBJECT_ID

q = {"query": mutation}
req = urllib.request.Request(
    URL,
    data=json.dumps(q).encode(),
    headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
    method="POST",
)
resp = json.loads(urllib.request.urlopen(req).read())
print(json.dumps(resp, indent=2))
