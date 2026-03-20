import sys

f = "/root/.nanobot/tools/linkedin_extractor.py"
with open(f, "r") as fh:
    code = fh.read()

# 1. Add trigger_tim_analysis function after send_alert function
trigger_func = '''

def trigger_tim_analysis(sender_name, message_text, linkedin_url):
    """Ask Tim to analyze an inbound LinkedIn message and suggest a reply."""
    prompt = (
        f"[LINKEDIN ALERT] New inbound LinkedIn message from {sender_name}:\\n\\n"
        f'\\"{message_text}\\"\\n\\n'
        f"LinkedIn profile: {linkedin_url}\\n\\n"
        f"Please:\\n"
        f"1. Look up this person in the CRM\\n"
        f"2. Check if they are enrolled in any campaign\\n"
        f"3. Based on the campaign context (if any) and their profile, suggest a reply\\n"
        f"4. Present the suggested reply so I can approve, edit, or schedule it"
    )
    try:
        resp = requests.post(
            "http://localhost:3001/api/chat",
            json={"message": prompt, "agent": "tim"},
            timeout=120
        )
        if resp.status_code == 200:
            log(f"Tim analysis triggered for {sender_name}")
        else:
            log(f"Tim analysis failed: HTTP {resp.status_code}")
    except Exception as e:
        log(f"Tim analysis error: {e}")
'''

# Insert after send_alert function (after the last pass in send_alert)
marker = "    except Exception:\n        pass\n\n\n\n# \u2500\u2500 Main"
if marker in code:
    code = code.replace(marker, "    except Exception:\n        pass\n" + trigger_func + "\n\n# \u2500\u2500 Main")
else:
    print("ERROR: Could not find insertion point for trigger_tim_analysis")
    sys.exit(1)

# 2. Add trigger_tim_analysis call after send_alert call for inbound
old_alert = '        send_alert(f"{format_pt_time(sent_at_ms)} \u2014 {sender_name}: {message_text[:400]}")\n        return 1'

new_alert = '        send_alert(f"{format_pt_time(sent_at_ms)} \u2014 {sender_name}: {message_text[:400]}")\n        trigger_tim_analysis(sender_name, message_text, sender_url)\n        return 1'

if old_alert in code:
    code = code.replace(old_alert, new_alert)
else:
    print("ERROR: Could not find send_alert call site")
    sys.exit(1)

with open(f, "w") as fh:
    fh.write(code)

print("OK - patched successfully")
