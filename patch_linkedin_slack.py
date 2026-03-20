#!/usr/bin/env python3
"""Patch linkedin_extractor.py to post alerts to Slack instead of web notifications."""
import sys

filepath = "/root/.nanobot/tools/linkedin_extractor.py"

with open(filepath, "r") as f:
    content = f.read()

# 1. Replace send_alert function
old_fn = '''def send_alert(message):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with open(ALERT_LOG, "a") as f:
            f.write(f"[{ts}] {message}\\n")
    except Exception:
        pass
    try:
        notif = {"type": "linkedin", "title": "LinkedIn Alert", "message": message, "timestamp": datetime.datetime.now().astimezone().isoformat(), "read": False}
        with open("/root/.nanobot/web_notifications.jsonl", "a") as f:
            f.write(json.dumps(notif) + "\\n")
    except Exception:
        pass'''

new_fn = '''def send_alert(message, sender_name="", linkedin_url=""):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with open(ALERT_LOG, "a") as f:
            f.write(f"[{ts}] {message}\\n")
    except Exception:
        pass
    # Post to Slack #linkedin-msg channel
    slack_token = os.environ.get("SLACK_TIM_BOT_TOKEN")
    slack_channel = os.environ.get("SLACK_LINKEDIN_CHANNEL")
    if slack_token and slack_channel:
        try:
            profile_line = f"\\n*Profile:* {linkedin_url}" if linkedin_url else ""
            slack_text = f":incoming_envelope: *LinkedIn Message*\\n*From:* {sender_name or 'Unknown'}{profile_line}\\n\\n>{message[:500]}"
            resp = requests.post(
                "https://slack.com/api/chat.postMessage",
                headers={"Authorization": f"Bearer {slack_token}", "Content-Type": "application/json"},
                json={"channel": slack_channel, "text": slack_text, "unfurl_links": False},
                timeout=10,
            )
            if not resp.json().get("ok"):
                print(f"Slack alert failed: {resp.json()}")
        except Exception as e:
            print(f"Slack alert error: {e}")'''

if old_fn in content:
    content = content.replace(old_fn, new_fn)
    print("Replaced send_alert function")
else:
    print("ERROR: Could not find send_alert function")
    sys.exit(1)

# 2. Update the send_alert call to pass sender_name and sender_url
old_call = 'send_alert(f"{format_pt_time(sent_at_ms)}'
# Find the full line
import re
pattern = r'send_alert\(f"\{format_pt_time\(sent_at_ms\)\} — \{sender_name\}: \{message_text\[:400\]\}"\)'
replacement = 'send_alert(f"{format_pt_time(sent_at_ms)} — {sender_name}: {message_text[:400]}", sender_name=sender_name, linkedin_url=sender_url)'
content, count = re.subn(pattern, replacement, content)
print(f"Updated {count} send_alert call(s)")

# 3. Add os import if not present
if "\nimport os\n" not in content and "\nimport os " not in content:
    content = content.replace("import json\n", "import json\nimport os\n", 1)
    print("Added os import")

with open(filepath, "w") as f:
    f.write(content)

print("Done")
