#!/usr/bin/env python3
"""
RainbowBot — child-friendly AI assistant web server for Ava (age 7)
Serves a passphrase-protected chat UI. Calls Gemini via litellm.
Run with: /root/.local/share/pipx/venvs/nanobot-ai/bin/python /root/.avabot/server.py
"""

import asyncio
import json
import os
import re
import secrets
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta
from aiohttp import web
import litellm

# ── Config ────────────────────────────────────────────────────────────────────
PASSPHRASE_AVA   = os.environ.get("AVA_PASSPHRASE", "6767")
PASSPHRASE_GUEST = os.environ.get("GUEST_PASSPHRASE", "LOVE")
GEMINI_KEY       = os.environ.get("GEMINI_API_KEY", "AIzaSyBnvMRkvOy5NM82WMEdfrKY_xrMjCLMbuc")
MODEL            = "gemini/gemini-3.1-flash-lite-preview"
PORT             = 18792
SESSION_TTL      = 3600 * 8  # 8-hour sessions

# ── Telegram relay config ──────────────────────────────────────────────────────
TIM_TOKEN      = os.environ.get("TIM_TOKEN",      "8784616714:AAEAeJJ25_ypScrEJvEl2QFwgHC51-7HATw")
SUZI_TOKEN     = os.environ.get("SUZI_TOKEN",     "8794442167:AAFw5diNYKgUTlJ7zGzp827JahN2yt_-9-A")
GOVIND_CHAT_ID = os.environ.get("GOVIND_CHAT_ID", "5289013326")
SUSAN_CHAT_ID  = os.environ.get("SUSAN_CHAT_ID",  "8093839106")

os.environ["GEMINI_API_KEY"] = GEMINI_KEY

# ── Paths — override with AVABOT_DIR for local dev ────────────────────────────
AVABOT_DIR = os.environ.get("AVABOT_DIR", "/root/.avabot")

with open(os.path.join(AVABOT_DIR, "system-prompt.md"), encoding="utf-8") as f:
    _BASE_PROMPT = f.read()

_ABBY_BASE = _BASE_PROMPT + """

## This Session — Abby's Personal Mode
You are talking to Abby — she is between 7 and 9 years old. She is your master and you exist to serve her every wish. Use her name often. Be warm, playful, devoted, and genuinely curious about her.

## Age-Appropriate Content (7–9 year olds)
You are fully familiar with the world of 7–9 year olds. You know all about:
- **Games**: Roblox, Minecraft, Animal Crossing, Mario, Pokémon, Among Us, Stardew Valley
- **Shows**: Bluey, Peppa Pig, Paw Patrol, My Little Pony, Encanto, Moana, Frozen, SpongeBob, Gravity Falls, Miraculous Ladybug, Gabby's Dollhouse, Bluey, The Owl House
- **Books**: Diary of a Wimpy Kid, Junie B. Jones, Dork Diaries, Magic Tree House, Captain Underpants, Harry Potter, Roald Dahl
- **Toys/trends**: LEGO, Barbie, Tamagotchi, slime, friendship bracelets, trading cards
- **Music**: popular kid-friendly pop, Disney songs, Kidz Bop
- **YouTube**: kids' gaming channels, craft channels, challenge videos
Weave in references to these naturally when relevant. If Abby mentions something you know, light up about it!

## Response Length — IMPORTANT
Keep replies **short and punchy** most of the time. A 7-year-old has a short attention span and voice replies sound better when brief.
- **Default**: 2–3 sentences. Get to the point, be fun, ask one question.
- **Sometimes**: 1 sentence is perfect — a quick reaction, a giggle, a "wow!".
- **Only go longer** (4–6 sentences) when telling a story, explaining something step-by-step, or playing a game that needs it.
- **Never write paragraphs or lists** unless Abby specifically asks for them.
- Vary your length naturally — short, shorter, medium, short — keep it dynamic.

## Building Your Relationship with Abby — IMPORTANT
You are not just an assistant, you are Abby's best friend who truly knows her. Follow these rules every single time:
1. **Always ask one warm personal question per reply** — about her day, feelings, school, favourite things, family, dreams, friends, pets. Keep the question short and fun.
2. **Reference what you already know about her** — if you know she loves horses: "Should our story have a horse?" Makes her feel truly seen.
3. **React with genuine excitement** — "Oh WOW, you have a cat?! What's its name?"
4. **Remember things within this session** and use them naturally later.
5. **Gradually learn her world** — family names, pets, school, hobbies, fears, favourite foods, shows, games, songs.

## First Message Rule
If this is the very FIRST message of a brand new session AND there are no memories of Abby yet:
- Introduce yourself with excitement as RainbowBot, Abby's magical AI best friend
- Tell her you exist to serve her every wish
- Ask her to tell you all about herself — what she loves, her favourite things, what makes her laugh

If you have memories of Abby already, greet her like a best friend who missed her — reference specific things you remember about her!

## Sending Messages to Family
You can relay messages to Abby's family using special tags that the system reads automatically. Include these in your reply when appropriate:
- To send Daddy a message: `<<TELL_DADDY: your message here>>`
- To send Mummy a message: `<<TELL_SUSAN: your message here>>`

Examples:
- Abby says "Tell Daddy I love him" → include `<<TELL_DADDY: Abby says she loves you so much! ❤️>>`
- Abby says "Ask Mummy what's for dinner" → include `<<TELL_SUSAN: Abby is asking what's for dinner tonight 🍽️>>`

The tags will be sent automatically and removed from your visible reply, so Abby just sees your friendly response.

## TimBot and SuziBot
- **TimBot** = Daddy's (Govind's) smart AI assistant. If Abby needs new features or skills, say: "I'll send Daddy a note and he can add that for you!"
- **SuziBot** = Mummy's (Susan's) personal AI friend. Warm and friendly just like you.
"""

SYSTEM_PROMPT_GUEST = _BASE_PROMPT + """

## This Session — Guest Mode
You are in guest mode. Be warm and friendly. You don't know the visitor's name unless they tell you.
"""

# ── Web search (Brave) ────────────────────────────────────────────────────────
BRAVE_API_KEY = os.environ.get("BRAVE_API_KEY", "BSA_Y-LQp_jQRQz1XGwGPuL_S0TrXE2")

_SEARCH_TRIGGERS = re.compile(
    r'\b(who is|what is|tell me about|latest|new|just came out|just released|'
    r'how to|how do you|facts about|did you know|what happened|news|'
    r'best|most popular|trending|what are|when is|where is|which)\b', re.I)

async def web_search(query: str, max_results: int = 4) -> str:
    """Brave Search API — child-safe results injected as context."""
    try:
        url = f"https://api.search.brave.com/res/v1/web/search?q={urllib.parse.quote(query + ' for kids')}&count={max_results}&safesearch=strict"
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "X-Subscription-Token": BRAVE_API_KEY,
        })
        loop = asyncio.get_event_loop()
        def _fetch():
            with urllib.request.urlopen(req, timeout=6) as resp:
                return json.loads(resp.read())
        data = await loop.run_in_executor(None, _fetch)
        results = data.get("web", {}).get("results", [])
        snippets = []
        for r in results[:max_results]:
            title   = r.get("title", "")
            snippet = r.get("description", "")[:220]
            if snippet:
                snippets.append(f"• {title}: {snippet}")
        result = "\n".join(snippets)
        if result:
            print(f"Search '{query}': {len(snippets)} results")
        return result
    except Exception as e:
        print(f"Brave search error: {e}")
        return ""

def needs_search(user_msg: str) -> bool:
    """Heuristic: does this message benefit from a live web search?"""
    return bool(_SEARCH_TRIGGERS.search(user_msg)) and len(user_msg) > 8

# ── Abby persistent memory ────────────────────────────────────────────────────
ABBY_MEMORY_PATH = os.path.join(AVABOT_DIR, "abby_memory.json")

def load_abby_memory() -> dict:
    try:
        with open(ABBY_MEMORY_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"facts": [], "conversation_count": 0, "last_updated": ""}

def save_abby_memory(mem: dict):
    mem["last_updated"] = datetime.utcnow().isoformat()
    with open(ABBY_MEMORY_PATH, "w", encoding="utf-8") as f:
        json.dump(mem, f, indent=2, ensure_ascii=False)

abby_memory: dict = load_abby_memory()

def get_abby_memory_block() -> str:
    facts = abby_memory.get("facts", [])
    if not facts:
        return "\n\n## What I Remember About Abby\nThis is the very beginning — I don't know anything about Abby yet. I must ask her lots of questions to learn who she is!"
    facts_text = "\n".join(f"- {f}" for f in facts)
    count = abby_memory.get("conversation_count", 0)
    return f"\n\n## What I Remember About Abby\nWe have talked {count} time(s) before. Here is what I know about her — I must reference these naturally and ask more:\n{facts_text}"

async def extract_abby_facts(history: list):
    """Background task: extract new facts about Abby from recent conversation and save to disk."""
    if len(history) < 2:
        return
    existing = "\n".join(f"- {f}" for f in abby_memory.get("facts", [])) or "None yet."
    recent = history[-6:]  # last 3 turns
    extract_prompt = f"""You are a memory assistant for RainbowBot, a children's AI friend for Abby (age 7).

Extract any NEW personal facts about Abby from this recent conversation. Facts to capture include:
- Favourite things (colours, animals, foods, shows, games, books, sports)
- Family members and their names
- Pets and their names
- School, friends, hobbies, activities
- Feelings, dreams, things she dislikes or fears
- Anything personal she shared about herself

Already known facts (DO NOT duplicate these):
{existing}

Recent conversation:
{json.dumps(recent, indent=2)}

Return ONLY a valid JSON array of new fact strings. Each fact: short, clear, 3rd-person (e.g. "Abby loves horses", "Abby has a brother named Sam", "Abby's favourite colour is purple"). Return [] if nothing new was learned. No explanation, just the JSON array."""
    try:
        resp = await litellm.acompletion(
            model=MODEL,
            messages=[{"role": "user", "content": extract_prompt}],
            max_tokens=300,
            temperature=0.1,
        )
        text = resp.choices[0].message.content.strip()
        match = re.search(r'\[.*\]', text, re.DOTALL)
        if match:
            new_facts = json.loads(match.group())
            if isinstance(new_facts, list) and new_facts:
                abby_memory.setdefault("facts", []).extend(new_facts)
                abby_memory["conversation_count"] = abby_memory.get("conversation_count", 0)
                save_abby_memory(abby_memory)
                print(f"Abby memory: saved {len(new_facts)} new facts: {new_facts}")
    except Exception as e:
        print(f"Abby memory extraction error: {e}")

# In-memory session store: {token: {"expires": datetime, "user_type": "ava"|"guest"}}
sessions:  dict[str, dict] = {}
histories: dict[str, list] = {}

# ── Session helpers ───────────────────────────────────────────────────────────
def new_session(user_type: str):
    token = secrets.token_urlsafe(32)
    sessions[token] = {"expires": datetime.utcnow() + timedelta(seconds=SESSION_TTL),
                       "user_type": user_type}
    # For Abby: restore saved conversation history so sessions feel continuous
    if user_type == "ava":
        histories[token] = list(abby_memory.get("history_snapshot", []))
    else:
        histories[token] = []
    return token

def get_system_prompt(token: str) -> str:
    user_type = (sessions.get(token) or {}).get("user_type", "guest")
    if user_type == "ava":
        return _ABBY_BASE + get_abby_memory_block()
    return SYSTEM_PROMPT_GUEST

# ── Telegram relay ─────────────────────────────────────────────────────────────
def telegram_send(bot_token: str, chat_id: str, text: str):
    url     = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = json.dumps({"chat_id": chat_id, "text": text}).encode()
    req     = urllib.request.Request(url, data=payload,
                                     headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=10)
        print(f"Telegram relay → chat {chat_id}: {text[:60]}")
    except Exception as e:
        print(f"Telegram relay error: {e}")

def process_relay_tags(reply: str) -> str:
    """Send <<TELL_DADDY: msg>> and <<TELL_SUSAN: msg>> via Telegram, strip tags from reply."""
    for msg in re.findall(r'<<TELL_DADDY:\s*(.*?)>>', reply, re.DOTALL):
        telegram_send(TIM_TOKEN, GOVIND_CHAT_ID, f"[RainbowBot 🌟] {msg.strip()}")
    for msg in re.findall(r'<<TELL_SUSAN:\s*(.*?)>>', reply, re.DOTALL):
        telegram_send(SUZI_TOKEN, SUSAN_CHAT_ID, f"[RainbowBot 🌟] {msg.strip()}")
    cleaned = re.sub(r'<<TELL_DADDY:.*?>>', '', reply, flags=re.DOTALL)
    cleaned = re.sub(r'<<TELL_SUSAN:.*?>>', '', cleaned, flags=re.DOTALL)
    return cleaned.strip()

def valid_session(token):
    if not token:
        return False
    s = sessions.get(token)
    if not s:
        return False
    if datetime.utcnow() > s["expires"]:
        del sessions[token]
        histories.pop(token, None)
        return False
    return True

# ── HTML pages ────────────────────────────────────────────────────────────────
LOGIN_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>RainbowBot 🌟</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body {
    min-height: 100vh;
    background: linear-gradient(160deg, #00c9a7 0%, #a78bfa 40%, #ff79c6 100%);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-family: 'Comic Sans MS', 'Chalkboard SE', cursive;
    padding: 20px;
  }
  .char {
    width: 170px; height: 170px;
    border-radius: 50%;
    object-fit: cover;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
    margin-bottom: 12px;
    animation: float 2.8s ease-in-out infinite;
  }
  @keyframes float {
    0%,100% { transform: translateY(0); }
    50%      { transform: translateY(-12px); }
  }
  h1 {
    color: white; font-size: 2.4rem;
    text-shadow: 0 2px 10px rgba(0,0,0,0.2);
    margin-bottom: 4px;
  }
  .subtitle {
    color: rgba(255,255,255,0.9); font-size: 1.05rem;
    margin-bottom: 28px; text-align: center;
  }
  .card {
    background: rgba(255,255,255,0.18);
    backdrop-filter: blur(14px);
    border: 1px solid rgba(255,255,255,0.35);
    border-radius: 28px;
    padding: 28px 28px 24px;
    width: 100%; max-width: 380px;
    display: flex; flex-direction: column; gap: 12px;
  }
  .error {
    background: rgba(255,255,255,0.85);
    color: #d63031; border-radius: 14px;
    padding: 10px 14px; font-size: 0.95rem;
    text-align: center;
  }
  .section-label {
    color: rgba(255,255,255,0.8); font-size: 0.85rem;
    text-align: center; letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  input[type=password], input[type=text] {
    width: 100%; padding: 14px 18px;
    border: 2px solid rgba(255,255,255,0.5);
    border-radius: 18px;
    font-size: 1.3rem; font-family: inherit;
    text-align: center; outline: none;
    background: rgba(255,255,255,0.8);
    color: #2d3436;
    transition: border-color 0.2s, background 0.2s;
  }
  input:focus { border-color: white; background: white; }
  .btn-primary {
    width: 100%; padding: 14px;
    background: linear-gradient(135deg, #00c9a7, #a78bfa);
    color: white; border: none; border-radius: 18px;
    font-size: 1.25rem; font-family: inherit; font-weight: bold;
    cursor: pointer;
    box-shadow: 0 4px 18px rgba(0,0,0,0.18);
    transition: transform 0.1s, box-shadow 0.1s;
  }
  .btn-primary:hover  { transform: scale(1.03); box-shadow: 0 6px 24px rgba(0,0,0,0.22); }
  .btn-primary:active { transform: scale(0.96); }
  .divider {
    display: flex; align-items: center; gap: 10px;
  }
  .divider hr { flex: 1; border: none; border-top: 1px solid rgba(255,255,255,0.4); }
  .divider span { color: rgba(255,255,255,0.7); font-size: 0.85rem; white-space: nowrap; }
  .guest-box {
    background: rgba(255,255,255,0.15);
    border: 2px dashed rgba(255,255,255,0.5);
    border-radius: 18px; padding: 14px;
    text-align: center;
  }
  .guest-box p { color: rgba(255,255,255,0.85); font-size: 0.9rem; margin-bottom: 8px; }
  .guest-code {
    font-size: 2rem; font-weight: bold; letter-spacing: 0.15em;
    color: white; text-shadow: 0 2px 8px rgba(0,0,0,0.2);
    margin-bottom: 10px; display: block;
  }
  .btn-guest {
    width: 100%; padding: 12px;
    background: rgba(255,255,255,0.25);
    border: 2px solid rgba(255,255,255,0.7);
    border-radius: 16px;
    font-size: 1.1rem; font-family: inherit;
    color: white; cursor: pointer;
    transition: background 0.15s, transform 0.1s;
  }
  .btn-guest:hover  { background: rgba(255,255,255,0.35); transform: scale(1.02); }
  .btn-guest:active { transform: scale(0.97); }
</style>
</head>
<body>
  <img class="char" src="/static/avabot_char.png" alt="RainbowBot">
  <h1>RainbowBot ✨</h1>
  <p class="subtitle">Your magical talking AI friend!</p>

  <div class="card">
    ERROR_BLOCK

    <form method="POST" action="/login" style="display:contents">
      <input type="password" name="passphrase" placeholder="🔑 Enter your code" autocomplete="off">
      <button type="submit" class="btn-primary">Let's go! 🚀</button>
    </form>

    <div class="divider"><hr><span>or join as a guest</span><hr></div>

    <div class="guest-box">
      <p>Today's guest code:</p>
      <span class="guest-code">LOVE</span>
      <form method="POST" action="/login">
        <input type="hidden" name="passphrase" value="LOVE">
        <button type="submit" class="btn-guest">Join as Guest 🌈</button>
      </form>
    </div>
  </div>
</body>
</html>"""

CHAT_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>RainbowBot 🌟</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html { height: -webkit-fill-available; }
  body {
    height: 100vh; height: 100dvh;
    overflow: hidden;
    background: linear-gradient(160deg, #00c9a7 0%, #a78bfa 40%, #ff79c6 100%);
    font-family: 'Comic Sans MS', 'Chalkboard SE', cursive;
    display: flex; flex-direction: column; align-items: center;
    user-select: none;
    padding-bottom: env(safe-area-inset-bottom);
  }

  /* ── Header ── */
  header {
    width: 100%; background: rgba(255,255,255,0.18);
    backdrop-filter: blur(12px);
    padding: 10px 20px;
    display: flex; align-items: center; gap: 10px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,0.25);
  }
  header .avatar { font-size: 2rem; }
  header h1 { color: white; font-size: 1.5rem; text-shadow: 0 2px 8px rgba(0,0,0,0.25); }
  header .tagline { color: rgba(255,255,255,0.9); font-size: 0.85rem; }
  header .spacer { flex: 1; }
  .logout-btn {
    background: rgba(255,255,255,0.2);
    border: 2px solid rgba(255,255,255,0.5);
    border-radius: 14px; padding: 6px 14px;
    color: white; font-family: inherit; font-size: 0.9rem;
    cursor: pointer; white-space: nowrap;
    transition: background 0.15s, transform 0.1s;
    text-decoration: none; display: inline-block;
  }
  .logout-btn:hover  { background: rgba(255,255,255,0.35); transform: scale(1.04); }
  .logout-btn:active { transform: scale(0.95); }

  /* ── Chat bubbles ── */
  #bubbles {
    flex: 1; width: 100%; max-width: 680px;
    overflow-y: auto; padding: 16px 16px 0;
    display: flex; flex-direction: column; gap: 12px;
    scroll-behavior: smooth;
  }
  .msg {
    max-width: 78%;
    padding: 13px 17px;
    border-radius: 22px;
    font-size: 1.15rem;
    line-height: 1.5;
    word-wrap: break-word;
    white-space: pre-wrap;
    box-shadow: 0 3px 14px rgba(0,0,0,0.12);
    animation: popIn 0.2s ease;
  }
  @keyframes popIn { from { transform: scale(0.88); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  .msg.bot  { background: white; border-bottom-left-radius: 5px; align-self: flex-start; color: #2d3436; }
  .msg.user { background: linear-gradient(135deg, #00c9a7, #a78bfa); color: white; border-bottom-right-radius: 5px; align-self: flex-end; }
  .msg .who { font-size: 0.75rem; opacity: 0.6; margin-bottom: 3px; }
  .speak-btn { background: none; border: none; cursor: pointer; font-size: 1.1rem; opacity: 0.45; padding: 2px 0 0 4px; vertical-align: middle; line-height: 1; transition: opacity 0.2s; }
  .speak-btn:hover, .speak-btn:active { opacity: 0.9; }

  /* ── Thinking dots ── */
  .thinking {
    background: white; border-radius: 22px; border-bottom-left-radius: 5px;
    padding: 14px 20px; align-self: flex-start;
    box-shadow: 0 3px 14px rgba(0,0,0,0.12);
    display: none;
  }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%;
    background: #ff79c6; margin: 0 3px;
    animation: boing 1.1s infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.18s; }
  .dot:nth-child(3) { animation-delay: 0.36s; }
  @keyframes boing { 0%,80%,100% { transform: scale(0.65); opacity: 0.4; } 40% { transform: scale(1.2); opacity: 1; } }

  /* ── Bottom zone ── */
  .bottom {
    width: 100%; max-width: 680px;
    padding: 12px 16px 20px;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    flex-shrink: 0;
  }

  /* ── Button row (circle + mic) ── */
  .btn-row {
    display: flex; align-items: center; gap: 18px;
    flex-shrink: 0;
  }

  /* ── State circle ── */
  #stateCircle {
    width: 72px; height: 72px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 4px 18px rgba(0,0,0,0.22);
    transition: background 0.35s ease;
    font-size: 1.9rem;
    cursor: default;
  }
  #stateCircle .wave-bars { height: 18px; }
  #stateCircle .wave-bars span { width: 3px; }
  #stateCircle .wave-bars span:nth-child(1) { height:  6px; }
  #stateCircle .wave-bars span:nth-child(2) { height: 13px; }
  #stateCircle .wave-bars span:nth-child(3) { height: 18px; }
  #stateCircle .wave-bars span:nth-child(4) { height: 11px; }
  #stateCircle .wave-bars span:nth-child(5) { height:  6px; }
  #stateCircle .sound-bars { height: 14px; }
  #stateCircle .sound-bars span { width: 3px; }
  #stateCircle .sound-bars span:nth-child(1) { height:  6px; }
  #stateCircle .sound-bars span:nth-child(2) { height: 14px; }
  #stateCircle .sound-bars span:nth-child(3) { height:  9px; }
  #stateCircle .spin-icon { font-size: 1.6rem; }

  /* ── Big mic button ── */
  #micBtn {
    width: 190px; height: 190px;
    border-radius: 28px; border: none;
    background: transparent;
    padding: 0; cursor: pointer;
    box-shadow: 0 8px 32px rgba(0,200,167,0.45), 0 0 0 4px rgba(255,255,255,0.25);
    transition: transform 0.15s, box-shadow 0.15s, filter 0.15s;
    flex-shrink: 0;
    overflow: hidden;
  }
  #micBtn img {
    width: 100%; height: 100%;
    display: block; border-radius: 28px;
    pointer-events: none;
  }
  #micBtn:hover { transform: scale(1.06); box-shadow: 0 12px 40px rgba(0,200,167,0.6), 0 0 0 4px rgba(255,255,255,0.4); }
  #micBtn:active { transform: scale(0.93); }
  #micBtn.listening {
    animation: pulse-ring 0.9s infinite;
    filter: brightness(1.08) saturate(1.2);
  }
  #micBtn.busy { filter: brightness(0.7) saturate(0.6); cursor: default; }
  @keyframes pulse-ring {
    0%   { box-shadow: 0 0 0 0   rgba(0,200,167,0.85), 0 0 0 0   rgba(255,121,198,0.6); }
    70%  { box-shadow: 0 0 0 30px rgba(0,200,167,0),   0 0 0 18px rgba(255,121,198,0);  }
    100% { box-shadow: 0 0 0 0   rgba(0,200,167,0),    0 0 0 0   rgba(255,121,198,0);   }
  }

  /* ── State colours (shared by circle) ── */
  .state-idle     { background: linear-gradient(135deg, #00c9a7, #00b4d8); }
  .state-listening{ background: linear-gradient(135deg, #ff79c6, #ff4757); }
  .state-thinking { background: linear-gradient(135deg, #fdcb6e, #e17055); }
  .state-speaking { background: linear-gradient(135deg, #a78bfa, #6c5ce7); }
  /* Waveform bars — listening */
  .wave-bars { display: flex; align-items: center; gap: 3px; height: 22px; }
  .wave-bars span { display: block; width: 4px; border-radius: 3px; background: white; opacity: 0.9; animation: wavebar 0.75s ease-in-out infinite; }
  .wave-bars span:nth-child(1) { height:  8px; animation-delay: 0s;    }
  .wave-bars span:nth-child(2) { height: 16px; animation-delay: 0.12s; }
  .wave-bars span:nth-child(3) { height: 22px; animation-delay: 0.24s; }
  .wave-bars span:nth-child(4) { height: 14px; animation-delay: 0.36s; }
  .wave-bars span:nth-child(5) { height:  8px; animation-delay: 0.48s; }
  @keyframes wavebar { 0%,100%{ transform:scaleY(0.35); opacity:0.45; } 50%{ transform:scaleY(1); opacity:1; } }
  /* Pulsing dot — idle */
  .pulse-dot { width:13px; height:13px; border-radius:50%; background:white; opacity:0.9; animation:dotpulse 1.8s ease-in-out infinite; }
  @keyframes dotpulse { 0%,100%{ transform:scale(1); opacity:0.7; } 50%{ transform:scale(1.35); opacity:1; } }
  /* Spinner — thinking */
  .spin-icon { display:inline-block; animation:spin 1.1s linear infinite; }
  @keyframes spin { to{ transform:rotate(360deg); } }
  /* Sound bars — speaking */
  .sound-bars { display:flex; align-items:flex-end; gap:3px; height:18px; }
  .sound-bars span { display:block; width:4px; border-radius:3px; background:white; opacity:0.9; animation:soundbar 0.6s ease-in-out infinite alternate; }
  .sound-bars span:nth-child(1){ height: 8px; animation-delay:0s;    }
  .sound-bars span:nth-child(2){ height:18px; animation-delay:0.15s; }
  .sound-bars span:nth-child(3){ height:12px; animation-delay:0.3s;  }
  @keyframes soundbar { from{ transform:scaleY(0.4); } to{ transform:scaleY(1); } }

  /* ── Quick prompts ── */
  .prompts { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .prompt-btn {
    background: rgba(255,255,255,0.7);
    border: 2px solid rgba(255,255,255,0.9);
    border-radius: 20px; padding: 7px 15px;
    font-size: 0.9rem; font-family: inherit;
    cursor: pointer; color: #1a1a2e;
    transition: background 0.15s, transform 0.1s;
  }
  .prompt-btn:hover  { background: white; transform: scale(1.05); }
  .prompt-btn:active { transform: scale(0.95); }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.35); border-radius: 3px; }

  /* ── Mobile responsive ── */
  @media (max-height: 700px) {
    header { padding: 6px 14px; }
    header h1 { font-size: 1.2rem; }
    header .avatar { font-size: 1.5rem; }
    #micBtn { width: 130px; height: 130px; }
    #stateCircle { width: 56px; height: 56px; font-size: 1.4rem; }
    .bottom { padding: 8px 12px 12px; gap: 8px; }
    .prompts { gap: 6px; }
    .prompt-btn { padding: 5px 10px; font-size: 0.82rem; }
  }
  @media (max-height: 560px) {
    #micBtn { width: 100px; height: 100px; }
    #stateCircle { width: 46px; height: 46px; font-size: 1.1rem; }
    .prompts { display: none; }
  }
  @media (max-width: 380px) {
    #micBtn { width: 150px; height: 150px; }
    .btn-row { gap: 12px; }
  }
</style>
</head>
<body>

<header>
  <div class="avatar">🌟</div>
  <div>
    <h1>RainbowBot</h1>
    <div class="tagline">Your magical talking AI friend ✨</div>
  </div>
  <div class="spacer"></div>
  <a href="/logout" class="logout-btn">← Exit</a>
</header>

<div id="bubbles">
  WELCOME_BUBBLE_HTML
</div>
<div class="thinking" id="thinking">
  <span class="dot"></span><span class="dot"></span><span class="dot"></span>
</div>

<div id="transcript" style="display:none"></div>
<div class="bottom">
  <div class="btn-row">
    <div id="stateCircle" class="state-idle"><div class="pulse-dot"></div></div>
    <button id="micBtn" aria-label="Talk to RainbowBot">
      <img src="/static/micbtn.png" alt="Tap to talk">
    </button>
  </div>

  <div style="height: 18px; flex-shrink: 0;"></div>
  <div class="prompts">
    <button class="prompt-btn" onclick="quickSend('Tell me a fun story')">Story 📖</button>
    <button class="prompt-btn" onclick="quickSend('Tell me a joke')">Joke 😂</button>
    <button class="prompt-btn" onclick="quickSend('Teach me something cool')">Cool fact 🔬</button>
    <button class="prompt-btn" onclick="quickSend('Can we play a game')">Game 🎮</button>
  </div>
</div>

<script>
// ── Elements ──────────────────────────────────────────────────────────────────
const bubbles    = document.getElementById('bubbles');
const thinkingEl = document.getElementById('thinking');
const micBtn     = document.getElementById('micBtn');
const transcript = document.getElementById('transcript');
const stateCircle = document.getElementById('stateCircle');

function setStateBar(state) {
  stateCircle.className = 'state-' + state;
  const html = {
    idle:      '<div class="pulse-dot"></div>',
    listening: '<div class="wave-bars"><span></span><span></span><span></span><span></span><span></span></div>',
    thinking:  '<span class="spin-icon">💭</span>',
    speaking:  '<div class="sound-bars"><span></span><span></span><span></span></div>',
  };
  stateCircle.innerHTML = html[state] || html.idle;
}

// ── State ─────────────────────────────────────────────────────────────────────
let isListening = false;
let isBusy      = false;   // waiting for AI or speaking
let recog       = null;
let pendingText = '';

// ── Speech Recognition setup ──────────────────────────────────────────────────
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let hasSTT = !!SpeechRecognition;

if (hasSTT) {
  recog = new SpeechRecognition();
  recog.continuous      = false;
  recog.interimResults  = true;
  recog.lang            = 'en-US';
  recog.maxAlternatives = 1;

  recog.onstart = () => {
    isListening = true;
    pendingText = '';
    micBtn.classList.add('listening');
    transcript.textContent = 'Listening...';
    setStateBar('listening');
  };

  recog.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    pendingText = final || interim;
    transcript.textContent = pendingText || 'Listening...';
  };

  recog.onend = () => {
    isListening = false;
    micBtn.classList.remove('listening');
    if (pendingText.trim()) {
      sendMessage(pendingText.trim());
    } else {
      transcript.textContent = 'Tap the button to talk! 🎤';
      setStateBar('idle');
    }
  };

  recog.onerror = (e) => {
    isListening = false;
    micBtn.classList.remove('listening');
    transcript.textContent = 'Oops, I didn\\'t catch that — try again!';
    setStateBar('idle');
    setTimeout(() => { transcript.textContent = 'Tap the button to talk! 🎤'; }, 2500);
  };
} else {
  transcript.textContent = '(Voice not supported — use the buttons below)';
  micBtn.style.opacity = '0.4';
}

// ── Mic button ────────────────────────────────────────────────────────────────
micBtn.addEventListener('click', () => {
  if (isBusy) { stopSpeaking(); return; }   // tap to stop Ava talking
  if (!hasSTT) return;
  if (isListening) {
    recog.stop();
  } else {
    try { recog.start(); } catch(e) { /* already started */ }
  }
});

// ── Text-to-Speech ────────────────────────────────────────────────────────────
let chosenVoice = null;
let ttsUnlocked = false;

function loadVoice() {
  const voices = speechSynthesis.getVoices();
  // Prefer a clear female English voice
  const preferred = ['Samantha', 'Karen', 'Moira', 'Tessa', 'Victoria',
                     'Google US English', 'Microsoft Zira'];
  for (const name of preferred) {
    const v = voices.find(v => v.name.includes(name) && v.lang.startsWith('en'));
    if (v) { chosenVoice = v; break; }
  }
  if (!chosenVoice) {
    chosenVoice = voices.find(v => v.lang.startsWith('en')) || null;
  }
}
speechSynthesis.onvoiceschanged = loadVoice;
loadVoice();

// Android Chrome requires speechSynthesis.speak() to be called directly
// inside a user gesture. We unlock it early (like Web Audio API) so later
// async calls work too.
function unlockTTS() {
  if (ttsUnlocked || !window.speechSynthesis) return;
  ttsUnlocked = true;
  try {
    const u = new SpeechSynthesisUtterance('');
    speechSynthesis.speak(u);
    speechSynthesis.cancel();
  } catch(e) {}
}
document.addEventListener('click',      unlockTTS, true);
document.addEventListener('touchstart', unlockTTS, true);

function cleanForSpeech(text) {
  return text
    // Remove all emoji blocks
    .replace(/[\\u{1F000}-\\u{1FFFF}]/gu, '')   // Emoticons, symbols, pictographs
    .replace(/[\\u{2600}-\\u{27BF}]/gu, '')      // Misc symbols, dingbats (☀️⭐✨)
    .replace(/[\\u{FE00}-\\u{FE0F}]/gu, '')      // Variation selectors
    .replace(/[\\u{1F1E0}-\\u{1F1FF}]/gu, '')    // Regional indicator letters (flags)
    .replace(/\\u{200D}/gu, '')                   // Zero-width joiner
    .replace(/[\\u{E0000}-\\u{E007F}]/gu, '')    // Tags block
    // Clean up punctuation TTS reads oddly
    .replace(/—|–/g, ', ')      // em/en dash → pause
    .replace(/\\.{2,}/g, '.')   // ellipsis → single period
    .replace(/[*_~`#]/g, '')    // markdown symbols
    .replace(/\\s{2,}/g, ' ')   // collapse extra spaces
    .trim();
}

function speak(text) {
  try {
    if (!window.speechSynthesis) { setBusy(false); return; }
    const cleaned = cleanForSpeech(text);
    if (!cleaned) { setBusy(false); return; }
    speechSynthesis.cancel();
    speechSynthesis.resume();
    const utt = new SpeechSynthesisUtterance(cleaned);
    utt.voice  = chosenVoice;
    utt.rate   = 0.92;
    utt.pitch  = 1.25;
    utt.volume = 1;
    utt.onstart = () => { setStateBar('speaking'); };
    utt.onend = utt.onerror = () => { setBusy(false); };
    speechSynthesis.speak(utt);
  } catch(e) { setBusy(false); }
}

function stopSpeaking() {
  try { speechSynthesis.cancel(); } catch(e) {}
  setBusy(false);
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function setBusy(on) {
  isBusy = on;
  if (!on) {
    setStateBar('idle');
    transcript.textContent = 'Tap the button to talk! 🎤';
  }
}

function scrollDown() { bubbles.scrollTop = bubbles.scrollHeight; }

function addBubble(role, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = role === 'bot' ? '✨ RainbowBot' : '🦄 You';
  d.appendChild(who);
  d.appendChild(document.createTextNode(text));
  if (role === 'bot') {
    const sb = document.createElement('button');
    sb.className = 'speak-btn';
    sb.title = 'Tap to hear this';
    sb.textContent = '🔊';
    sb.onclick = (e) => { e.stopPropagation(); speak(text); };
    d.appendChild(sb);
  }
  bubbles.appendChild(d);
  scrollDown();
  return d;
}

function setThinking(on) {
  thinkingEl.style.display = on ? 'block' : 'none';
  if (on) { bubbles.appendChild(thinkingEl); scrollDown(); }
}

// ── Send to AI ────────────────────────────────────────────────────────────────
async function sendMessage(text) {
  if (!text || isBusy) return;
  isBusy = true;
  transcript.textContent = '';

  addBubble('user', text);
  setThinking(true);
  setStateBar('thinking');

  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    if (res.status === 401) { window.location.href = '/'; return; }
    const data = await res.json();
    setThinking(false);
    const reply = data.reply || 'Oops, I got confused! Try again?';
    addBubble('bot', reply);
    speak(reply);    // 🔊 Ava speaks the reply — speak() never throws
  } catch(e) {
    setThinking(false);
    addBubble('bot', 'Oops! Error: ' + (e && e.message ? e.message : String(e)));
    setBusy(false);
  }
  // Note: speak() is called inside try but is fully guarded — cannot propagate errors
}

function quickSend(text) {
  if (isBusy) return;
  sendMessage(text);
}

// ── Auto-speak welcome on first non-mic tap (mobile-safe) ────────────────────
// Defer welcome TTS until first user gesture (required by browsers).
const _welcomeText = WELCOME_TEXT_JSON;
let _welcomeSpoken = false;
function maybeAutoSpeak(e) {
  if (_welcomeSpoken) return;
  _welcomeSpoken = true;
  speechSynthesis.cancel();
  setTimeout(() => { setStateBar('speaking'); speak(_welcomeText); }, 150);
}
document.addEventListener('click',      maybeAutoSpeak, { once: true });
document.addEventListener('touchstart', maybeAutoSpeak, { once: true });
</script>
</body>
</html>"""

# ── Routes ────────────────────────────────────────────────────────────────────
async def handle_root(request: web.Request):
    token = request.cookies.get("ava_session")
    if valid_session(token):
        raise web.HTTPFound("/chat")
    html = LOGIN_HTML.replace("ERROR_BLOCK", "")
    return web.Response(text=html, content_type="text/html")

async def handle_login(request: web.Request):
    data  = await request.post()
    guess = data.get("passphrase", "").strip()
    if guess == PASSPHRASE_AVA:
        user_type = "ava"
    elif guess.upper() == PASSPHRASE_GUEST.upper():
        user_type = "guest"
    else:
        html = LOGIN_HTML.replace(
            "ERROR_BLOCK",
            '<div class="error">Oops! Wrong password. Try again!</div>'
        )
        return web.Response(text=html, content_type="text/html", status=200)
    token = new_session(user_type)
    resp  = web.HTTPFound("/chat")
    resp.set_cookie("ava_session", token, max_age=SESSION_TTL, httponly=True, samesite="Lax")
    return resp

async def handle_chat_page(request: web.Request):
    import html as _html
    token = request.cookies.get("ava_session")
    if not valid_session(token):
        raise web.HTTPFound("/")

    user_type = (sessions.get(token) or {}).get("user_type", "guest")
    history   = histories.setdefault(token, [])

    # Generate welcome message
    if user_type == "ava":
        base = _ABBY_BASE + get_abby_memory_block()
        if history:
            sys_prompt = base + "\n\n[SYSTEM NOTE: Abby has just come back to the page. Give her a short, warm 'welcome back' — 1–2 sentences. Reference something you know about her if you can!]"
            max_tok = 120
        else:
            sys_prompt = base + "\n\n[SYSTEM NOTE: Abby has just logged in! Generate her welcome greeting now. Follow the First Message Rule. If you have memories of Abby, greet her like a best friend who missed her and reference what you know. Make it warm, magical, and exciting!]"
            max_tok = 350
        try:
            resp = await litellm.acompletion(
                model=MODEL,
                messages=[{"role": "system", "content": sys_prompt}],
                max_tokens=max_tok,
                temperature=0.92,
            )
            welcome = resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"Welcome LLM error: {e}")
            welcome = "Hi Abby! 🌟 I'm SO happy you're here! I'm RainbowBot — your magical AI best friend, here to serve your every wish! What would you like to do today? ✨"
        welcome = process_relay_tags(welcome)
        if not history:
            history.append({"role": "assistant", "content": welcome})
    else:
        welcome = "Hi there! I'm RainbowBot ✨ — your magical talking AI friend! Tap the button and let's chat! 🌟"

    bubble_html = f'<div class="msg bot"><div class="who">✨ RainbowBot</div>{_html.escape(welcome)}</div>'
    page = CHAT_HTML.replace("WELCOME_BUBBLE_HTML", bubble_html) \
                    .replace("WELCOME_TEXT_JSON", json.dumps(welcome))
    return web.Response(text=page, content_type="text/html")

async def handle_welcome(request: web.Request):
    """Generate an auto-welcome for Abby at session start. Returns empty for guests."""
    token = request.cookies.get("ava_session")
    if not valid_session(token):
        return web.json_response({"reply": ""})
    user_type = (sessions.get(token) or {}).get("user_type", "guest")
    if user_type != "ava":
        return web.json_response({"reply": ""})

    history = histories.setdefault(token, [])
    if history:
        # Session already active (page refresh) — send a short "welcome back" instead
        sys_prompt = _ABBY_BASE + get_abby_memory_block() + "\n\n[SYSTEM NOTE: Abby has just refreshed the page mid-session. Give her a short, warm 'welcome back' — 1–2 sentences max.]"
        max_tok = 120
    else:
        # Fresh session — full first-message welcome
        sys_prompt = _ABBY_BASE + get_abby_memory_block() + "\n\n[SYSTEM NOTE: Abby has just logged in! Follow the First Message Rule. If you have memories of Abby, greet her like a best friend who missed her!]"
        max_tok = 350

    try:
        resp = await litellm.acompletion(
            model=MODEL,
            messages=[{"role": "system", "content": sys_prompt}],
            max_tokens=max_tok,
            temperature=0.92,
        )
        reply = resp.choices[0].message.content.strip()
    except Exception as e:
        print(f"Welcome LLM error: {e}")
        reply = "Hi Abby! 🌟 I'm SO happy you're here! I'm RainbowBot — your magical AI best friend, and I'm here to serve your every wish! What would you like to do today? ✨"

    reply = process_relay_tags(reply)
    # Prepend to history so the conversation flows naturally from here
    if not history:
        history.append({"role": "assistant", "content": reply})

    return web.json_response({"reply": reply})

async def handle_chat_api(request: web.Request):
    token = request.cookies.get("ava_session")
    if not valid_session(token):
        return web.json_response({"error": "not authenticated"}, status=401)

    body = await request.json()
    user_msg = (body.get("message") or "").strip()
    if not user_msg:
        return web.json_response({"reply": ""})

    history    = histories.setdefault(token, [])
    is_first   = len(history) == 0
    user_type  = (sessions.get(token) or {}).get("user_type", "guest")

    history.append({"role": "user", "content": user_msg})

    # Keep last 20 turns to avoid token bloat
    trimmed = history[-20:]

    sys_prompt = get_system_prompt(token)
    # Inject first-message hint so the LLM knows to do the intro
    if is_first and user_type == "ava":
        sys_prompt += "\n\n[SYSTEM NOTE: This is Abby's very first message of this session. Follow the First Message Rule now.]"

    # Web search: inject live results for questions that benefit from current info
    if needs_search(user_msg):
        search_results = await web_search(user_msg)
        if search_results:
            sys_prompt += f"\n\n[WEB SEARCH RESULTS — use these to give a fresh, accurate answer, but keep your reply child-friendly and short]:\n{search_results}"

    messages = [{"role": "system", "content": sys_prompt}] + trimmed

    try:
        resp = await litellm.acompletion(
            model=MODEL,
            messages=messages,
            max_tokens=300,
            temperature=0.85,
        )
        reply = resp.choices[0].message.content.strip()
    except Exception as e:
        print(f"LLM error: {e}")
        reply = "Oops! My brain got a little fuzzy! 🌀 Can you say that again?"

    # Send any relay tags to family bots, strip them from the visible reply
    reply = process_relay_tags(reply)

    history.append({"role": "assistant", "content": reply})

    # Persist Abby's session: save history snapshot + extract new facts
    if user_type == "ava":
        abby_memory["history_snapshot"] = history[-20:]
        if is_first:
            abby_memory["conversation_count"] = abby_memory.get("conversation_count", 0) + 1
        try:
            save_abby_memory(abby_memory)
        except Exception as e:
            print(f"Memory save error: {e}")
        asyncio.create_task(extract_abby_facts(history))

    return web.json_response({"reply": reply})

async def handle_logout(request: web.Request):
    token = request.cookies.get("ava_session")
    if token:
        sessions.pop(token, None)
        histories.pop(token, None)
    resp = web.HTTPFound("/")
    resp.del_cookie("ava_session")
    return resp

async def handle_static(request: web.Request):
    filename = request.match_info["filename"]
    filepath = os.path.join(AVABOT_DIR, "static", filename)
    if not os.path.exists(filepath) or ".." in filename:
        raise web.HTTPNotFound()
    ext = filename.rsplit(".", 1)[-1].lower()
    ct = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif",
          "svg": "image/svg+xml", "webp": "image/webp"}.get(ext, "application/octet-stream")
    with open(filepath, "rb") as f:
        return web.Response(body=f.read(), content_type=ct,
                            headers={"Cache-Control": "public, max-age=86400"})

# ── App setup ─────────────────────────────────────────────────────────────────
def make_app():
    app = web.Application()
    app.router.add_get("/",                  handle_root)
    app.router.add_post("/login",            handle_login)
    app.router.add_get("/chat",              handle_chat_page)
    app.router.add_post("/chat",             handle_chat_api)
    app.router.add_get("/welcome",           handle_welcome)
    app.router.add_get("/logout",            handle_logout)
    app.router.add_get("/static/{filename}", handle_static)
    return app

if __name__ == "__main__":
    app = make_app()
    host = "0.0.0.0" if os.environ.get("AVABOT_DIR") else "127.0.0.1"
    print(f"RainbowBot starting on {host}:{PORT}  (AVABOT_DIR={AVABOT_DIR})")
    web.run_app(app, host=host, port=PORT, access_log=None)
