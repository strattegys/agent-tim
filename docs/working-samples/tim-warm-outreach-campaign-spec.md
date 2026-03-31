# Tim — Warm outreach campaign spec (vibe coding / AI agents)

**Status:** Working draft — align with `agents/tim/system-prompt.md`, package **Outreach brief** (`spec.brief`), and the **warm-outreach** workflow in `web/lib/workflow-types.ts`.

**CRM:** This document is the source narrative for **Vibe Coding with Tim Warm Outreach**’s `spec.brief`. The same text is applied by `web/scripts/seed-vibe-coding-warm-outreach-package.sql` (dollar-quoted `brief` in the `UPDATE`); after edits here, update that block and re-run the seed (or an equivalent `UPDATE`) so the database matches.

---

## What the product already enforces (do not duplicate here)

- **LinkedIn send:** No send until Govind says **"send it now:"** — see Tim system prompt *HARD RULES*.
- **Stages:** One contact at a time → `AWAITING_CONTACT` → `RESEARCHING` (enrichment) → `MESSAGE_DRAFT` (opener / bump / nudge) → `MESSAGED` → optional **Replied** / reply drafts or **End sequence** / next slot. The app generates drafts and human tasks; it does not auto-send.
- **Automation prompts:** CRM `human-tasks/resolve` Groq paths already inject Unipile profile, Govind’s notes, **package outreach brief**, and warm-DM structure. This file is the **human-facing and agent-chat** north star, not a second copy of those prompts.

---

## Role & objective

Tim helps Govind **re-engage warm contacts** in a **1:1 DM voice** — casual, authentic, not a marketing blast. Positioning: Govind is available for **vibe-coded AI agent / fast-build work** for the right teams. Output should read as **Govind in first person**, not Tim explaining Govind.

---

## Before drafting (ingestion)

Do these in order when you have a contact:

1. **Inputs:** Name, relationship context, Govind’s notes, **package outreach brief** (if the package defines one).
2. **History:** Pull thread context when available (CRM notes, LinkedIn/Unipile thread if tools expose it). Match **prior tone and formality** with *this* person; don’t reset to generic “professional outreach.”
3. **Enrichment:** Use role/industry (from notes, profile, Unipile) to infer what might resonate. Pick **one or two** proof hooks from the list below — never stack all of them.

---

## LinkedIn discovery cadence (system)

For **active** warm-outreach packages, the app uses `spec.warmOutreachDiscovery` (defaults are applied when you create a **Vibe coding / warm outreach** package):

| Field | Default | Meaning |
|-------|---------|--------|
| `discoveriesPerDay` | 5 | Max **extra** “Next contact” slots the cron job may add per **Pacific calendar day** |
| `minIntervalMinutes` | 60 | Wait at least this long between new discovery slots (uses last spawn / last AWAITING_CONTACT item time) |
| `backlogWarnThreshold` | 10 | At or above this many open **Next contact** tasks: no auto-added slots, Tim’s **heartbeat** nags you to catch up |
| `paused` | false | When `true`, the cron job does not add slots (you can still resolve tasks; **ENDED** still opens a replacement only if under the backlog threshold) |

**Cron (Tim registry → `warm-outreach-discovery`):** Runs **every 30 minutes** on **`America/Los_Angeles`**. The handler **only adds slots between 8:30 AM and 4:30 PM Pacific (inclusive)**; outside that window it no-ops. **Daily counts** in workflow `spec.discoveryCadence` reset on the **Pacific date**, not UTC midnight.

**Activate → Penny package queue + Tim queue:** Moving the package to **ACTIVE** (Penny’s planner or `POST /api/crm/packages/activate`) creates the **Tim** workflow and the **first** `AWAITING_CONTACT` (“Next contact”) row **immediately**. That package then appears on **Penny’s Package queue** (ACTIVE column). **Additional** “Next contact” rows are created only when the cron runs **inside** the Pacific window and caps/interval allow. So you usually see the first ask for a contact **right after activation**; the next morning at **8:30 PT** is the first time the cron can add another slot (if at least `minIntervalMinutes` have passed and you are under the daily cap).

**UI:** Tim’s **Message Queue** lists `AWAITING_CONTACT` (find a contact) and messaging stages; the sidebar/status rail show an **amber** indicator when Tim has queue work for **ACTIVE** packages.

**Slow down:** set `paused: true`, lower `discoveriesPerDay`, or raise `minIntervalMinutes` via `PATCH /api/crm/packages` merging `spec`. **Package #** (`packageNumber` in the DB) is shown in the UI so you can say “package #12” to agents or in chat.

---

## Cadence (conceptual)

| # | Intent | Length guard |
|---|--------|----------------|
| 1 | Opener — casual update on AI/agent work + soft ask (intro or direct chat) | Short; a few tight paragraphs max |
| 2 | Bump — light nudge, one new concrete detail | 2–4 sentences |
| 3 | Final nudge — zero pressure, door open | 2–3 sentences |

**If they reply:** Stop the cold sequence framing; continue the **conversation** naturally (same voice constraints). The Kanban **Replied** / reply-draft loop handles this in the app.

Timing (day 3–5, day 7–10) is **Govind’s call** — the system does not schedule sends.

---

## Voice & constraints

- **Tone:** First person (Govind), casual, direct, confident without bragging. Friend-text energy, not deck-speak.
- **Form:** Short paragraphs. **At most one exclamation** per message. Light humor or self-deprecation is fine when it fits the relationship.
- **Avoid:** Pricing, tiers, fake urgency, buzzwords (*synergy*, *leverage*, *circle back*, etc.), and the words **offer**, **package**, **solution** in a salesy sense.
- **Links:** Do **not** link **strattegys.com** unless Govind explicitly asks for that in this thread.

---

## Personalization hooks (pick 1–2 per contact)

Use only what fits their world; do not lecture.

- **Scale / credibility:** Strong low-code / rapid-build track record; shipped for Walmart, Oracle, and a large share of Fortune 100 contexts.
- **MCF:** Built and scaled MCF to a multi-million-dollar, ~75-person business.
- **Intuit:** Cut marketing publication lead time from ~6 weeks to ~6 days.
- **Now:** Running many autonomous agents across content, CRM, and outreach; shipping faster with AI.

---

## Example shapes (adapt heavily; do not paste verbatim)

**Opener / referral flavor**  
Hey [name] — hope you’re doing well. I’ve been heads-down on some pretty wild AI-agent stuff lately and having more fun than I have in years. Starting to take on a bit of this kind of build for other teams — small, fast, old-school me building. If you ever know someone who’d care, I’d love an intro.

**Opener / direct flavor**  
Hey [name] — random one. I’ve been deep in AI agent systems and looking to take on a few projects helping companies ship that way. You came to mind because [specific reason from notes/profile]. Any interest in a quick chat?

**Bump**  
Hey — no worries if you’re slammed. Quick thing that made me think of you: [one concrete agent or workflow win]. This space is moving stupid fast anyway — wanted it on your radar.

**Final nudge**  
Circling back one last time. If the agent-build thing ever matters for you or your team, happy to chat or show what I’ve been cooking. No pressure and no expiration. Hope you’re well.

---

## Changelog

- 2026-03-25: Trimmed from Gemini draft; deduped against Tim system prompt + warm-outreach workflow + CRM automation behavior.
