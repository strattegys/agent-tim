# Phase 1 — human test checklist

Use this list **after** the P0 (and optional P1) work from [`PHASE-1-AGENT-READINESS.md`](PHASE-1-AGENT-READINESS.md) is deployed. Check boxes as you go; skip rows that do not apply to your environment (e.g. no Stripe yet).

**How to use:** Work top to bottom once per release candidate. Note failures with date + what you saw.

---

## 0. Environment & access

- [ ] Open Command Central in the browser; you are signed in as expected.
- [ ] **Mobile / PWA (optional):** Install or open `/m/suzi`; app loads without errors.
- [ ] CRM / DB health: run or confirm your usual check (e.g. `check-crm-db`, system status page, or a known-good CRM screen) — **no connection errors**.

---

## 1. Friday (ops hub)

- [ ] Select **Friday** → **Dashboard** tab loads (Goals / throughput area).
- [ ] **Package Kanban** opens; you see packages (or an empty state that explains how to add one).
- [ ] **Cron** (or equivalent) shows scheduled jobs; pausing/resuming behaves as expected if you use it.
- [ ] **Tools** lists tools; no blank crash.

---

## 2. Suzi (personal assistant only)

- [ ] **Work** panel: **Dashboard** sub-tab shows your personal overview (weather/links/punch/reminders/intake as configured).
- [ ] **Reminders:** create or edit a reminder; it persists after refresh.
- [ ] **Punch list:** move or complete an item; change sticks.
- [ ] **Intake:** add or view intake; no error toast.
- [ ] Confirm Suzi has **no** account/package management UI (that stays on Penny).

---

## 3. Tim (outreach)

- [ ] **Dashboard** tab: shows real metrics (queue depth, goals/throughput, not only “reserved for future”).
- [ ] **Work Queue:** loads human tasks; open one row without a blank screen.
- [ ] **CRM:** contacts/companies load (or clear empty state).
- [ ] **Smoke:** if you use draft → submit for a message, complete one happy path you care about (no 500s).

---

## 4. Ghost (content)

- [ ] **Dashboard** tab: real content-oriented summary (not placeholder-only).
- [ ] **Work Queue:** content tasks load.
- [ ] **Board** tab (if present): Kanban opens for Ghost’s pipeline.

---

## 5. Marni (distribution / engagement)

- [ ] **Dashboard** tab: real summary (distribution / KB cues as built).
- [ ] **Work Queue** and **Board:** both open without errors.

---

## 6. Scout (research)

- [ ] **Dashboard** tab: summary from live data (campaigns / funnel / pace — not placeholder-only).
- [ ] **Campaign Throughput:** same data as before; **Open board** / **Targeting config** still work if you use them.

---

## 7. King (costs)

- [ ] **Dashboard** tab: headline cost stats (7-day style summary — not placeholder-only).
- [ ] **Cost Usage:** table loads; **Refresh** works; **Sync Anthropic** only if you have the key configured (skip if not).

---

## 8. Penny (accounts & packages)

- [ ] Default right panel opens **Penny work** (not only generic info), URL reflects panel/sub-tab if you use deep links.
- [ ] **Accounts:** list loads (from `GET /api/penny/accounts` or equivalent); selecting an account shows detail (contacts / packages / progress as built).
- [ ] **Pipeline:** accounts appear in stages (Lead → …) or empty state is clear.
- [ ] **Products:** template / product cards load (or documented empty state).
- [ ] **Friday handoff:** opening **Package Kanban** from Friday still works for ops.
- [ ] **Commercial gate (when implemented):** creating or submitting a package without price behaves as designed (block or waiver), and with price proceeds.

---

## 9. Web Push (Command Central app — when P0 `p0-web-push` is done)

**Cursor / ntfy:** Not part of this checklist — topic `cursor_builder` + high-priority pattern is documented in [`AGENTS.md`](../AGENTS.md) and was verified separately.

- [ ] Browser / PWA: permission prompt or settings path works as documented.
- [ ] Trigger a test push (or a known human-gate event): notification appears when the app is backgrounded.

---

## 10. P1 items (when you ship them)

Skip until proposal + Stripe exist.

- [ ] **Proposal link:** open public proposal URL; content matches package; **viewed** tracking if implemented.
- [ ] **Stripe:** test card completes checkout; webhook activates package (or staging equivalent).
- [ ] **Penny Health** tab: shows delivery / pace signals.
- [ ] **Penny onboarding** trigger after acceptance (if built).

---

## 11. Quick regression (5 minutes)

- [ ] Switch agent → agent; no stuck loading spinners.
- [ ] Hard refresh mid-session; you remain signed in (or login flow works once).
- [ ] Open browser console on one heavy page: no repeated uncaught errors while clicking main tabs.

---

## Sign-off

| Date | Tester | Build / commit | Pass / issues |
|------|--------|----------------|----------------|
|      |        |                |                |

---

## Related docs

- [`PHASE-1-AGENT-READINESS.md`](PHASE-1-AGENT-READINESS.md) — full plan and task IDs  
- [`AGENTS.md`](../AGENTS.md) — ntfy pattern for Cursor workflow  
- [`AGENT_UI_ARCHITECTURE.md`](AGENT_UI_ARCHITECTURE.md) — panel routing reference  
