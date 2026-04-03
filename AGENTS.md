# COMMAND-CENTRAL — agent / Composer context

This file is for **Cursor / Composer** and humans: durable project memory that is **not** tied to a single chat.

## Canonical plan

**Single source of truth for phase 1 work:** [`docs/PHASE-1-AGENT-READINESS.md`](docs/PHASE-1-AGENT-READINESS.md)

It includes:

- **Task tracker** — P0/P1/P2 IDs (`p0-tim-dashboard`, `p0-penny-accounts-api`, `p0-web-push`, etc.).
- **Configuration-first** — extend `WORKFLOW_TYPES`, `PackageSpec`, packages/activation; avoid one-off hardcoding where config suffices.
- **Account model** — `company` = account; `_package.customerId` + `customerType: 'company'`; derived stages (Lead → Delivered); no new CRM columns for stage.
- **Penny** — client success: workspace (Accounts, Pipeline, Products; Health P1), `GET /api/penny/accounts`, commercial/source/proposal spec, unified proposal page + Stripe (P1).
- **Per-agent P0** — Friday crons, Tim/Suzi smoke, Scout/Marni/Ghost cadence, King `cost_summary` + package margin, dashboards for Tim/Ghost/Marni/Scout/King/Penny.
- **Web Push (P0)** — in-app / PWA mobile alerts when the **Command Central** app needs attention (VAPID, `sw.js`, subscription API). Documented in the plan under “Mobile notifications — Web Push”.

**Companion docs:** [`docs/PENNY-PACKAGE-SALES-PLAN.md`](docs/PENNY-PACKAGE-SALES-PLAN.md), [`docs/AGENT_UI_ARCHITECTURE.md`](docs/AGENT_UI_ARCHITECTURE.md), [`docs/PHASE-1-HUMAN-TEST-CHECKLIST.md`](docs/PHASE-1-HUMAN-TEST-CHECKLIST.md).

---

## Human alerts while implementing in Cursor (ntfy)

The maintainer may be **away from the desk** during long implementation. **Cursor does not send phone push.** Use **ntfy.sh** so they get a **real notification (sound/vibration)** when the agent needs approval, a decision, or hits a blocker.

### Setup (already done by user)

- Topic name: **`cursor_builder`**
- User has the **ntfy** app on their phone subscribed to that topic.

### How to send (required for audible alert)

Plain POSTs often **do not** buzz the phone. Use **high priority** and a **title**:

```bash
curl -H "Priority: high" -H "Title: Cursor Builder" -d "Short message: what you need from them" https://ntfy.sh/cursor_builder
```

On Windows PowerShell, the same idea works with `curl.exe` or `Invoke-WebRequest` if `curl` is aliased—prefer the headers above in whatever HTTP client you use.

### When to ping

- **End of work (required):** Send **one** high-priority ntfy whenever you **stop** for the session — whether the batch **completed successfully**, you’re **paused** waiting on them, or you’re **done** and they should test. The maintainer cannot see Cursor from the couch; without this ping they don’t know you finished. Start the body with **Done:** or **Blocked:** or **Paused:** so it’s scannable.
- Need **approval** before a risky change (schema, auth, production config).
- **Blocked** (missing secret, failing test, ambiguous requirement) — ping immediately, not only at the end.
- **Milestone** mid-session only if they asked for pings per chunk.

Do **not** spam: batch non-urgent items into one **completion** message when possible; separate **blocked** pings are OK.

### Deploy (demo / prod)

- **Standard:** Push to **`master`** on GitHub. [`.github/workflows/deploy-web.yml`](.github/workflows/deploy-web.yml) runs `tsc` + `next build`, then SSHes to the droplet (`/opt/agent-tim`), `git pull`, BWS env, `docker compose` rebuild **web**. Triggers when **`web/**`** (and listed paths) change.
- **Droplet:** No extra service was added for this batch — Penny accounts use existing CRM tables (`company`, `_package`, `person`). No new migration file is required for `GET /api/penny/accounts` beyond your current CRM schema.
- **Manual fallback:** [`scripts/deploy-web.sh`](scripts/deploy-web.sh) (interactive; for emergencies).

### Security note

`ntfy.sh` topics are **unauthenticated** unless the user enables ntfy access control. Treat the topic as **semi-public**: never put secrets, tokens, or customer PII in the body—only high-level labels (“Penny accounts API ready for review”).

---

## Quick implementation-order reminder (from plan)

P0 block order (see plan for full detail):

1. Platform / Friday crons / Tim+Suzi smoke  
2. **Agent dashboards** (Tim, Ghost, Marni, Scout, King, Penny workspace)  
3. Penny accounts API + account convention + commercial gates  
4. Web Push  
5. King wiring + margin  
6. Scout/Marni/Ghost spec-driven cadence  

---

## Repo touchpoints (high level)

| Area | Path |
|------|------|
| Shell / panels | `web/app/CommandCentralClient.tsx`, `web/lib/command-central-url.ts` |
| Agents | `web/lib/agent-registry.ts`, `web/lib/agent-spec.ts` |
| Penny tool | `web/lib/tools/package-manager.ts` |
| Costs | `web/lib/tools/cost-summary.ts`, `web/app/api/costs/summary/route.ts` |
| Throughput / goals | `web/app/api/crm/workflow-throughput/route.ts`, `web/lib/workflow-types.ts` |

When starting a large change set, **reread** [`docs/PHASE-1-AGENT-READINESS.md`](docs/PHASE-1-AGENT-READINESS.md) and align with the task tracker IDs.
