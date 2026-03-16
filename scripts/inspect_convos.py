import json, urllib.request

API_KEY = "1df1fdda-51e5-46c1-8a97-99dde05a11d1"
req = urllib.request.Request(
    "https://api.connectsafely.ai/linkedin/messaging/recent-messages?limit=20",
    headers={"Authorization": f"Bearer {API_KEY}"})
resp = json.loads(urllib.request.urlopen(req, timeout=15).read())

KNOWN_KEYS = {"conversationId","conversationUrn","backendConversationUrn","conversationUrl",
              "participants","unreadCount","lastActivityAt","createdAt","lastReadAt","isRead",
              "state","latestMessage"}

for c in resp.get("conversations", []):
    latest = c.get("latestMessage") or {}
    sender = latest.get("senderName", "?")
    participants = c.get("participants", [])
    p0 = participants[0].get("name") if participants else ""
    state = c.get("state", "")
    extra = {k: v for k, v in c.items() if k not in KNOWN_KEYS}
    msg_keys = list(latest.keys())
    print(f"state={repr(state):20s} extra={extra}")
    print(f"  msg_keys: {msg_keys}")
    print(f"  sender={repr(sender)} -> p0={repr(p0)}")
    print()
