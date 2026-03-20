#!/usr/bin/env python3
"""GraphQL-based contact search for Twenty CRM.

Usage: python3 search_contacts_graphql.py <query> <api_key> <base_url>

Searches both firstName and lastName using ilike (case-insensitive).
Multi-word queries split into individual terms — ALL terms must match
across firstName or lastName (AND logic).
Output matches the REST API format: {"data": {"people": [...]}}
Exit code 3 if no results found.
"""

import sys
import json
import urllib.request

if len(sys.argv) < 4:
    print("Usage: search_contacts_graphql.py <query> <api_key> <base_url>", file=sys.stderr)
    sys.exit(1)

query = sys.argv[1]
api_key = sys.argv[2]
base_url = sys.argv[3]

# Split query into words — each word must match firstName OR lastName
words = query.strip().split()

if len(words) == 1:
    # Single word: search firstName OR lastName
    filter_clause = """filter: {
    or: [
      { name: { firstName: { ilike: "%%%s%%" } } },
      { name: { lastName: { ilike: "%%%s%%" } } }
    ]
  }""" % (words[0], words[0])
else:
    # Multi-word: each word must match firstName OR lastName (AND across words)
    conditions = []
    for w in words:
        conditions.append(
            '{ or: [ { name: { firstName: { ilike: "%%%s%%" } } }, { name: { lastName: { ilike: "%%%s%%" } } } ] }' % (w, w)
        )
    filter_clause = "filter: { and: [ %s ] }" % ", ".join(conditions)

graphql_query = """{
  people(%s) {
    edges {
      node {
        id
        createdAt
        updatedAt
        deletedAt
        name { firstName lastName }
        emails { primaryEmail additionalEmails }
        linkedinLink { primaryLinkLabel primaryLinkUrl secondaryLinks }
        jobTitle
        phones { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode additionalPhones }
        city
        avatarUrl
        companyId
      }
    }
  }
}""" % filter_clause

req = urllib.request.Request(
    base_url + "/graphql",
    data=json.dumps({"query": graphql_query}).encode(),
    headers={
        "Authorization": "Bearer " + api_key,
        "Content-Type": "application/json",
    },
)

try:
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)

edges = data.get("data", {}).get("people", {}).get("edges", [])
if not edges:
    sys.exit(3)

# Transform to match REST API output format
people = [e["node"] for e in edges]
json.dump({"data": {"people": people}}, sys.stdout, indent=2)
print()  # trailing newline
