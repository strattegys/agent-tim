# Agent Builder Launch — Campaign Brief

**Package:** Agent Builder Launch
**Status:** DRAFT
**Owner:** Tim
**Landing page:** strattegys.com/builder

---

## Objective

Drive conversations from new LinkedIn connection acceptances toward Govind's **AI Agent Team Builder** offering. These are fresh connections — no prior relationship. The landing page (strattegys.com/builder) is the primary campaign asset: it tells the story, shows the agent team, and has the booking CTA.

---

## Two workflows

Spec below matches the built-in registry in `web/lib/workflow-types.ts` (`linkedin-opener-sequence`, `reply-to-close`).

### 1. Opener Sequence (`linkedin-opener-sequence`)

Connection accepts → cycle **Message Draft (3)** (`DRAFT_MESSAGE`) → **Send message** (`SENT_MESSAGE`) up to **three** times (opener + two nudges, ~3 business days apart).

**When they reply:** move this **opener** row to `REPLIED` and **leave it on Replied**—that is the resting stage on the opener board. Log what they said in CRM. **Do not** jump to `COMPLETED` on the opener just because they wrote back. All **actual LinkedIn reply** work happens on **Reply to Close**: add the same person on that workflow at `REPLIED`; the app promotes that row to `REPLY_DRAFT` and notifies Tim. Move the opener row to `COMPLETED` only when you are done tracking it here (e.g. Reply to Close is live and you want to close the opener row).

**If three sends with no reply** (or you stop early) → `COMPLETED` on the opener.

**Friday Goals:** daily **target** = **new targets** started on this sequence (distinct contacts), not “sends.”

**Stages (board order):**

| Key | Label (UI) | Role |
|-----|------------|------|
| `DRAFT_MESSAGE` | Message Draft (3) | Tim drafts send 1–3; human approves / send via LinkedIn |
| `SENT_MESSAGE` | Send message | DM out; loop to draft if &lt;3 sends and no reply, or → `REPLIED` / `COMPLETED` |
| `REPLIED` | Replied | They replied; **stay here** on opener while conversation runs on Reply to Close |
| `COMPLETED` | Completed | Opener row closed (no reply after 3 sends, stopped early, or finished after handoff) |

**Transitions:** `DRAFT_MESSAGE` → `SENT_MESSAGE` → `DRAFT_MESSAGE` (loop) or `REPLIED` or `COMPLETED`; `REPLIED` → `COMPLETED` (when you choose to close the opener row).

---

### 2. Reply to Close (`reply-to-close`)

Use when someone replied during the **opener** sequence (opener item should sit on `REPLIED`). **Conversation work** (`REPLY_DRAFT` onward) runs **here**, not on the opener board.

**Entry:** add the person at `REPLIED`. The system moves the item to `REPLY_DRAFT` and notifies Tim (Unipile send gate on approve).

**Cadence after our sends:** main reply → **~3 calendar days** wait → optional **Follow-up 1** → **~7 days** wait → optional **Follow-up 2** → **~7 days** final wait → if still quiet, **Keep in touch** (`KIT_ENROLLED`). Any inbound reply can return the row to `REPLY_DRAFT`. **Converted** ends the row on clear commercial progress.

**Friday Goals:** **no daily target** for this workflow (volume follows opener); **throughput is still measured** (new threads per day) in the Goals tab under “Measured throughput (no target).”

**Stages (board order):**

| Key | Label (UI) | Role |
|-----|------------|------|
| `REPLIED` | Replied | Entry; app → `REPLY_DRAFT` |
| `REPLY_DRAFT` | Reply Draft | Tim drafts; human send gate |
| `REPLY_SENT` | Reply Sent | Brief stop; then **Waiting ~3d** |
| `AWAITING_THEIR_REPLY` | Waiting for reply (~3d) | No send; then FU1 draft or back to reply draft if they wrote |
| `FOLLOW_UP_ONE_DRAFT` | Follow-up 1 draft | First bump after silence |
| `FOLLOW_UP_ONE_SENT` | Follow-up 1 sent | Brief stop; then **Waiting ~7d** |
| `AWAITING_AFTER_FOLLOW_UP_ONE` | Waiting (~7d) | Then FU2 draft or `REPLY_DRAFT` if they reply |
| `FOLLOW_UP_TWO_DRAFT` | Follow-up 2 draft | Last structured nudge |
| `FOLLOW_UP_TWO_SENT` | Follow-up 2 sent | Brief stop; then **Waiting (final ~7d)** |
| `AWAITING_AFTER_FOLLOW_UP_TWO` | Waiting (final ~7d) | Then **Keep in touch** or `REPLY_DRAFT` / **Converted** |
| `CONVERTED` | Converted | Terminal — deal momentum |
| `KIT_ENROLLED` | Keep in touch | Terminal — long-cycle nurture |

**Transitions (summary):** from most stages you can reach **`REPLY_DRAFT`** (they replied again), **`CONVERTED`**, or **`KIT_ENROLLED`** where the board allows; waiting stages advance to the next draft or back to **`REPLY_DRAFT`** per the row above. Full graph is in `workflow-types.ts` `defaultBoard.transitions`.

---

## Target profile

- Founders, heads of ops/growth, or technical leads at companies with 5–200 people
- Already aware of AI but haven't built agents that actually run daily
- Frustrated with demos and prototypes that don't produce real output
- Technical enough to understand the importance of code and the need to move beyond it
- Industries: B2B services, SaaS, agencies, consulting, professional services

---

## Positioning

Govind isn't selling software. He built an eight-agent team that runs his own business — sales, content, operations, finance — and now helps other founders and small teams build theirs. **Scout opens the pipeline** (research and prospect work); the rest of the team carries execution. The proof is the system itself, documented publicly. The landing page walks through the whole model.

### Credible urgency — the AI audience has already moved

**The insight:** Prospects' *customers* and *markets* are already being reshaped by AI-native speed, personalization, and always-on help. That is not hype — it's the new baseline people compare every vendor and employer against. The risk isn't "miss the trend"; it's **quietly falling behind the expectation curve** while competitors and substitutes compound small daily advantages (response time, follow-up, content surface area, internal throughput).

**How to use this in copy (without fake scarcity):**

- Frame urgency as **market physics**, not deadlines: shifting expectations, widening gap between teams that operationalize agents and teams still in pilot mode.
- Speak to **their audience** (their buyers, members, users, hiring pipeline): "The people you're trying to reach are already being trained elsewhere on what 'fast' and 'tailored' mean."
- One line of **consequence**, not fear: if they wait, they don't stay still — they get relatively more expensive and slower versus peers who wired agents into real workflows.
- Still **no** false countdowns, "spots left," or pricing pressure — urgency comes from **competitive and customer reality**, not manufactured FOMO.

---

## Voice & constraints

- **First person (Govind),** professional-casual. "New colleague" energy — friendly and direct but not overly familiar.
- Short paragraphs. At most one exclamation per message.
- **Always include strattegys.com/builder in the opener message.** Follow-ups can reinforce it when natural.
- Do NOT reference a prior relationship or shared history — there is none.
- Open with a brief thanks for connecting, then get to the point.
- Always tie outreach to something specific from their profile (role, company, industry, a post) so it doesn't feel mass-blasted.
- Establish credibility quickly — the eight-agent model IS the hook.
- First names only. No "Hope you're doing well" filler.
- **Avoid:** pricing, tiers, **fake** urgency (countdowns, scarcity lies), buzzwords (synergy, leverage, circle back), and the words "offer," "package," "solution" in a salesy sense.
- **Do use:** **credible** urgency — your reader's *audience* (customers, market, talent) is already calibrating to AI-led experiences; the window is about **keeping pace with that bar**, not a fake deadline.
- Do NOT describe all eight agents in a message — pick one or two that would resonate with this specific person's world.

---

## Personalization hooks (pick 1–2 per contact)

- **The working model:** "I have eight AI agents running my business — sales, content, ops, finance. Not demos, actual daily output."
- **Audience-first urgency:** "Your customers (or users, or candidates) are already being shaped by AI-led experiences — the question is whether your operation keeps up with that bar or slowly looks 'heavy' by comparison."
- **Enterprise credibility:** 300+ apps shipped, rapidly deployed low-code systems for almost 20% of the Fortune 100 including Walmart and Oracle. Scaled MCF to multi-millions and 75 people.
- **The builder angle:** "I got back into building — vibe coding lets me ship what used to take a team of ten."
- **Specific agents (use sparingly, pick what fits their world):** **Scout starts the process** — research, intelligence, who’s worth the conversation — then Tim handles LinkedIn outreach and reply drafting, Ghost writes content, Marni distributes it, King tracks finances, Suzi keeps everything organized, Penny builds client packages, Friday orchestrates.
- **The departments:** MarkOps, ContentOps, FinOps, Utility — real org structure, not one chatbot.
- **Built in public:** Documented the whole journey — articles on architecture, the first agent-booked call, message passing between agents.

---

## Opener sequence — message guidance for the 3-send cycle

Each person cycles through DRAFT_MESSAGE → SENT_MESSAGE up to three times. Tim drafts each message fresh — the examples below set the **intent and tone** for each send in the cycle.

### Send 1: Opener (ALWAYS include strattegys.com/builder)

| Intent | Tone | Length |
|--------|------|--------|
| Introduce Govind, establish the agent model, share the page, soft ask | Professional-casual, intriguing | 3–4 short paragraphs max |

**Example A — value-first introduction (audience + urgency):**

> Hey [name] — thanks for connecting. I'll keep it short: the people *you* sell to (and hire, and retain) are already being trained by AI-native experiences elsewhere — faster answers, tighter follow-up, more surface area. The gap that worries me isn't "adopt AI"; it's teams that **wait** while that bar keeps moving.
>
> I've built eight AI agents that run my business day to day — outreach, content, operations, finance. Not a demo — real output for months. I put the whole model on one page: strattegys.com/builder.
>
> I'm helping [founders / teams in their industry] get a comparable system in place before the expectation curve gets too far ahead of them. [One sentence on why their profile caught your attention — role, company, industry fit].
>
> Happy to compare notes if this is on your radar.

**Example B — credentials + market shift:**

> Hey [name] — appreciate the connect. Quick context: I spent a decade shipping enterprise apps (Walmart, Oracle, Fortune 100), then another decade in B2B growth. What I'm focused on now is different — **eight AI agents** running four departments in my own business, because the audience side of the market isn't waiting on anyone's roadmap.
>
> Full walkthrough here: strattegys.com/builder.
>
> Reaching out because [specific reason from their profile]. Curious whether you're seeing the same pressure — buyers and users expecting speed and continuity they didn't ask for two years ago.

### Send 2: Follow-up (~3 business days after send 1, reinforce link)

| Intent | Tone | Length |
|--------|------|--------|
| Add one specific proof point, nudge the link | Light, adds something new | 2–4 sentences |

**Example:**

> Hey [name] — quick follow-up. One concrete proof point: **Scout** starts the process on my side — research and targeting — then **Tim** runs the LinkedIn thread. That handoff booked a call without me living in the inbox. That's the kind of throughput your *audience* is starting to assume is normal somewhere, even if your stack still says "manual."
>
> If you didn't get to the page yet: strattegys.com/builder — whole eight-agent model in one place. Thought it'd be relevant given [their role / industry] and how fast expectations are moving.

### Send 3: Final nudge (~3 business days after send 2, link optional)

| Intent | Tone | Length |
|--------|------|--------|
| Close the loop, zero pressure, door open | Warm, brief | 2–3 sentences |

**Example:**

> Hey [name] — last note on this. If building AI agents for [their domain — sales, ops, content, etc.] ever becomes a priority, happy to walk through what I've built. The page is still there: strattegys.com/builder. Either way, good to be connected.

---

## Reply to Close guidance

These people don't know Govind yet. Replies need to build trust quickly.

### General approach
- Match their energy and curiosity level
- Briefly establish credibility when relevant (300+ apps, Fortune 100 background, scaled MCF) — they haven't heard this before
- Don't assume they read the landing page; summarize key points if they ask
- Goal is a 15-minute intro call, but let it happen naturally — they need a reason to give time to someone they just met
- If they engage but aren't ready, enroll in Keep in Touch — the relationship is new and may need time

### When to re-share the link
- If they ask "how does it work" or "tell me more": "I actually laid the whole model out here — strattegys.com/builder — eight agents, four departments, the works."
- If they seem interested but haven't committed: "Here's that page again if it's easier to look when you have a minute: strattegys.com/builder"
- If they're ready for a call: "There's a booking link on the page (strattegys.com/builder) or just tell me a time and I'll make it work."
- Don't re-share if they've clearly already seen it and are engaging on substance — at that point, just have the conversation.

### Handling common replies
- **"Interesting, tell me more"** → Brief summary of the model + link. Offer a call.
- **"What does it cost?"** → Don't quote pricing in DM. "It depends on what you're building — easier to talk through on a quick call. 15 minutes, no pitch deck."
- **"Not the right time"** → "Totally understand. I'll stay connected — if it ever becomes relevant, the page is there. Good to know you."
- **"I'm already using [tool/platform]"** → "That's great — what I do is different from platforms. It's custom agent teams built on your stack, not a SaaS product. Happy to compare notes if you're ever curious."
- **"Can you send more info?"** → Re-share strattegys.com/builder. "This page covers the full model — agents, departments, how it works. Let me know if anything jumps out."

---

## Changelog

- 2026-04-01: Initial brief created. Aligned with strattegys.com/builder landing page content. Optimized for new connection acceptances (no prior relationship).
- 2026-04-01: Updated workflow stages to match actual `linkedin-opener-sequence` (DRAFT_MESSAGE ↔ SENT_MESSAGE cycle ×3) and `reply-to-close` definitions.
- 2026-04-02: Package workflow spec rewritten to match `workflow-types.ts`: opener **Replied** as resting stage (conversation on Reply to Close); full reply-to-close cadence (waits, two follow-ups, final wait, terminals); Goals target on opener only; measured throughput for reply-to-close without a target.
- 2026-04-02: Added **credible urgency** framing (AI audience / expectation curve); refreshed opener and follow-up examples; clarified voice rules (forbid fake scarcity, allow market-shift urgency).
- 2026-04-02: Narrative fix — **Scout starts the process** (research / top of pipeline); Tim carries LinkedIn outreach; Send 2 proof point and hooks updated to match (no generic “one agent did it all”).
