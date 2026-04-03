# Penny — client success agent (durable working plan)

**Canonical phase-1 plan:** [`docs/PHASE-1-AGENT-READINESS.md`](PHASE-1-AGENT-READINESS.md) — consolidated plan with all agents, account model, Penny workspace, Stripe integration, and implementation roadmap. This file is the **detailed Penny workspace design companion** (wireframes, data model, component architecture).

---

## Strategic role

Penny is the **client success agent** — owning the entire **account** lifecycle from first lead through delivery, satisfaction, close-out, and renewal. Friday is the ops/admin hub; **Penny's lens is the account (company)**.

### The account concept

An **account** is a `company` row in the CRM. It is the fundamental business unit for Penny:

- **Pre-package:** An account can be a **lead** (Tim/Scout have engaged people at that company) before any package exists.
- **Package delivery:** Packages are sold **to accounts** (`_package.customerId` -> `company.id`, `customerType: 'company'`). People at the account are **contacts** who receive communication.
- **Satisfaction & renewal:** Health, revenue, and lifecycle tracking are all at the account level.

**Why accounts, not people:** A business relationship is with a company. Multiple people at the same company may be contacts; multiple packages may be sold to the same account. Penny needs the account view to see the full picture.

### How accounts map to the existing data model (zero schema changes)

| Concept | Existing structure | Convention change |
|---------|-------------------|-------------------|
| Account | `company` table (Twenty CRM) | No change — already exists |
| Account contacts | `person.companyId` -> `company.id` | No change — already linked |
| Package -> Account | `_package.customerId` + `customerType` | Use `customerType: 'company'` (today UI defaults to `'person'`) |
| Lead detection | `person` in Tim/Scout workflows + `person.companyId` | Derive: company has people in outreach but no package yet |
| Account stage | Not stored | **Derived** from aggregate package/workflow state (see below) |

### Derived account stage (no new columns)

| Stage | Derivation |
|-------|-----------|
| **Lead** | Company has people in Tim's outreach workflows but no `_package` linked |
| **Prospect** | Company has people in reply-to-close (active conversation) but no package |
| **Proposal** | Company has at least one `DRAFT` package |
| **Review** | Company has at least one `PENDING_APPROVAL` package |
| **Customer** | Company has at least one `ACTIVE` package |
| **Delivered** | Company has only `COMPLETED` packages (none active/draft) |
| **Churned** | Only completed packages and no renewal after N days (Phase 3) |

Priority: highest active stage wins (Customer > Review > Proposal > Prospect > Lead > Delivered).

### Penny's lifecycle phases

| Phase | Today | Target |
|-------|-------|--------|
| **Product development** | Templates edited in Cursor | Penny evolves templates from delivery data + market signals |
| **Pre-sale** | Creates DRAFT packages | Track accounts as leads from Tim/Scout, tailor packages per account |
| **Sale** | Submit + approve | Commercial terms, Stripe fulfillment, account-level |
| **Onboarding** | Nothing | Welcome sequence, intake questionnaire, expectation-setting per account |
| **Delivery** | Nothing | Progress tracking vs `targetCount`, milestone alerts, account updates |
| **Quality** | Nothing | Spot-check deliverable quality, flag issues to Govind |
| **Communication** | Nothing | Regular status updates to account contacts (report or message) |
| **Satisfaction** | Nothing | Check-ins, feedback capture, health scoring per account |
| **Close-out** | Nothing | Delivery summary, final report, `COMPLETED` transition |
| **Renewal** | Nothing | "What's next?" conversation, upsell identification at account level |

### Cross-agent gaps that support Penny

- **King:** Per-account P&L, invoicing/collections (currently global cost only).
- **Tim:** Structured `CONVERTED` signal back from `reply-to-close` to Penny/King. Tim's outreach contacts provide the "lead" signal for account detection.
- **Scout:** Research targets feed Penny's pipeline when their companies become leads.
- **Friday:** Package health heartbeat (actual vs contracted progress).
- **Outbound email tool:** Needed for account updates, onboarding sequences, delivery reports (Postmark inbound exists but no outbound tool yet).

---

## Penny's workspace — `PennyWorkPanel`

### Design principle

Penny's workspace is **account-centric**. Everything is organized around accounts (companies) and their journey — not around workflows or system operations. This is the fundamental difference from Friday's admin-oriented dashboard.

### Shell routing

| Setting | Value |
|---------|-------|
| New `CommandCentralRightPanel` value | `"penny-work"` |
| Default panel for Penny | `"penny-work"` (was `"info"`) |
| Header icon | Building/users icon (account-centric metaphor) |
| URL | `?agent=penny&panel=penny-work` |
| Penny sub-tab param | `pennySub=accounts\|pipeline\|health\|products` |

### Tabs

Four tabs, each serving a distinct function in Penny's lifecycle:

```
+---------------------------------------------------------+
|  Penny   Client Success Agent                    i  B   |
+----------+----------+----------+------------------------+
| Accounts | Pipeline | Health   | Products               |
+----------+----------+----------+------------------------+
|                                                         |
|          (active tab content)                           |
|                                                         |
+---------------------------------------------------------+
```

---

### Tab 1: Accounts (default) — Account Relationship Hub

**Layout:** Master-detail (follows Tim's `TimMessagesPanel` pattern).

**Left panel (~35%):**

- Search bar (company name, website, contact name)
- Filter row: `All` | `Customers` | `Prospects` | `Leads` | `Delivered` | `At Risk`
- Scrollable account list
- Each row:
  - Company initial avatar (Penny accent color)
  - Company name
  - Derived stage badge (Lead / Prospect / Proposal / Customer / Delivered)
  - Active packages count
  - Health dot: green (on track), amber (behind), red (at risk), gray (no active)
  - Contact count (people at this company)

**Right panel (~65%) — selected account:**

- **Account header card:**
  - Company name, website, LinkedIn link
  - Derived stage badge
  - Summary stats: Total packages | Active now | Total revenue (`spec.commercial.contractPriceUsd` summed) | Contacts
  - Quick actions: "New package" | "Draft status update" | "Schedule check-in"

- **Contacts section:**
  - List of people at this company (`person.companyId = company.id`)
  - Each contact: name, role/title, LinkedIn, which workflows they appear in
  - "Add contact" action (links to CRM)

- **Packages section:**
  - Card per package linked to this account
  - Each card: package name, stage badge, overall progress bar, deliverable list with per-deliverable mini progress and owner agent avatar
  - Reuses simplified `PackageDetailCard` components

- **Timeline section (Phase 2):**
  - Key events: First contact, Package proposed, Won, Milestones hit, Completed
  - Notes and communication history

**Data sources:**

| Need | Source | Status |
|------|--------|--------|
| Account list | New `GET /api/penny/accounts` | **New endpoint** |
| | Joins `company` -> `_package` (where `customerType = 'company'`) + `person` (where `companyId`) -> `_workflow_item` | |
| | Returns: company info, derived stage, package counts by stage, contact count, total revenue, health signal | |
| Account packages | `GET /api/crm/packages?customerId=X&includeWorkflowBreakdown=true` | Existing |
| Package progress | `GET /api/crm/packages/progress?packageId=X` | Existing |
| Account contacts | `GET /api/crm/directory/contacts?companyId=X` (or new param) | Existing (may need filter param) |
| Revenue | Sum `spec.commercial.contractPriceUsd` from account's packages | Computed client-side |

**New `GET /api/penny/accounts` query shape:**

```sql
SELECT
  c.id,
  c.name,
  c."domainNamePrimaryLinkUrl" AS website,
  c."linkedinLinkPrimaryLinkUrl" AS linkedin,
  COUNT(DISTINCT pkg.id) FILTER (WHERE pkg.stage = 'ACTIVE')   AS active_packages,
  COUNT(DISTINCT pkg.id) FILTER (WHERE pkg.stage = 'DRAFT')    AS draft_packages,
  COUNT(DISTINCT pkg.id) FILTER (WHERE pkg.stage = 'COMPLETED') AS completed_packages,
  COUNT(DISTINCT pkg.id)                                        AS total_packages,
  COUNT(DISTINCT p.id)                                          AS contact_count
FROM company c
LEFT JOIN "_package" pkg
  ON pkg."customerId" = c.id
  AND pkg."customerType" = 'company'
  AND pkg."deletedAt" IS NULL
LEFT JOIN person p
  ON p."companyId" = c.id
  AND p."deletedAt" IS NULL
WHERE c."deletedAt" IS NULL
GROUP BY c.id
HAVING COUNT(pkg.id) > 0
   OR EXISTS (
     SELECT 1 FROM person p2
     JOIN "_workflow_item" wi ON wi."sourceId" = p2.id
       AND wi."sourceType" = 'person'
       AND wi."deletedAt" IS NULL
     WHERE p2."companyId" = c.id AND p2."deletedAt" IS NULL
   )
ORDER BY
  COUNT(DISTINCT pkg.id) FILTER (WHERE pkg.stage = 'ACTIVE') DESC,
  c.name ASC
```

Stage derivation is done client-side or in a SQL `CASE` using the aggregate counts.

---

### Tab 2: Pipeline — Account Sales Funnel

**Layout:** Kanban board (reuses `PackageKanbanBoard` pattern with account-level columns).

**Columns (derived account stage):**

| Column | Derivation | Description |
|--------|-----------|-------------|
| **Lead** | Company has people in outreach workflows, no package | Tim/Scout identified; not yet proposed |
| **Proposal** | Company has at least one `DRAFT` package | Active proposal being designed |
| **Review** | Company has `PENDING_APPROVAL` package | Pending sign-off |
| **Customer** | Company has `ACTIVE` package | Active engagement |
| **Delivered** | Company has only `COMPLETED` packages | Finished — renewal opportunity |

**Cards represent accounts, not packages:**

- Company name (prominent, top line)
- Contact count badge
- Package summary: "2 packages, $8,500 total"
- Value badge: total `contractPriceUsd` across account packages
- Days in current stage (time since last stage change across packages)
- Mini progress bar (for Customer-stage accounts: aggregate delivery progress)

**Interaction:** Click a card -> opens the Accounts tab with that account selected (cross-tab navigation).

**Data source:** Same `GET /api/penny/accounts` endpoint, grouped into columns by derived stage.

---

### Tab 3: Health — Delivery Satisfaction Dashboard

**Layout:** Summary stats row + scrollable card list.

**Summary stats (4 stat cards across top):**

| Stat | Source |
|------|--------|
| Active accounts | Count of accounts with `ACTIVE` packages |
| On Track | Count + % where health = green |
| At Risk | Count where health = amber or red |
| Revenue at risk | Sum `contractPriceUsd` for at-risk accounts |

**Account health cards (one per active account, sorted worst-first):**

- Company name + account stage
- Per-package rows, each showing:
  - Package name + overall progress bar
  - Per-deliverable mini progress, owner agent avatar, status
  - Health badge: On Track / Behind / At Risk / Complete
- Aggregate account health: worst package health determines account health
- Days since last `_workflow_item` stage transition across all packages
- "Last account update" timestamp (Phase 2)

**Health scoring logic (client-side, Phase 1):**

```
expectedProgress = (daysSinceActivation / estimatedDurationDays) x targetCount
actualProgress   = items in terminal / close stages
healthRatio      = actualProgress / max(expectedProgress, 1)

if healthRatio >= 0.85 -> On Track
if healthRatio >= 0.50 -> Behind
else                   -> At Risk
if all deliverables at targetCount -> Complete

Account health = worst package health across all active packages
```

`estimatedDurationDays` derived from `pacing` on deliverables or defaults to 30 days.

**Data sources:**

| Need | Source |
|------|--------|
| Active accounts + packages | `GET /api/penny/accounts?stage=customer` + `GET /api/crm/packages?customerId=X&includeWorkflowBreakdown=true` |
| Detailed progress | `GET /api/crm/packages/progress?packageId=X` |
| Commercial | `spec.commercial.contractPriceUsd` from package rows |

---

### Tab 4: Products — Product Development Board

**Layout:** Card grid (not Kanban — simpler, more visual for ideation).

**Product cards:**

- Product/template name
- Short description (from template `brief` or `description` field)
- Target audience line
- Base price range
- Status badge: `Idea` | `Research` | `Design` | `Ready` | `Published`
- Accounts sold count (number of accounts using packages from this template)
- Quick action: "Create package from this product" (for `Ready`+ products)

**Data backing: Option A — Extend package templates (confirmed)**

Add fields to `PackageTemplateSpec` in `web/lib/package-types.ts`:

```typescript
interface PackageTemplateSpec {
  // ... existing fields ...
  productStage?: 'idea' | 'research' | 'design' | 'ready' | 'published';
  description?: string;
  targetAudience?: string;
  priceRange?: { min: number; max: number; currency: string };
}
```

The Products tab reads from `PACKAGE_TEMPLATES` + `PLANNER_PACKAGE_TEMPLATES`. "Published" templates are available for self-serve on Strattegys. Package sold count is derived by counting `_package` rows per `templateId`.

---

### Component architecture

```
web/components/penny/
|-- PennyWorkPanel.tsx             -- Tab bar + tab switching (outer shell)
|-- PennyAccountsPanel.tsx         -- Accounts tab: master-detail account view
|-- PennyAccountDetailCard.tsx     -- Account detail (right side of Accounts)
|-- PennyAccountContactList.tsx    -- Contacts at an account
|-- PennyPipelinePanel.tsx         -- Pipeline tab: account sales kanban
|-- PennyPipelineCard.tsx          -- Account card (company + value emphasis)
|-- PennyHealthPanel.tsx           -- Health tab: delivery satisfaction
|-- PennyHealthCard.tsx            -- Per-account health card
|-- PennyProductsPanel.tsx         -- Products tab: product board
|-- PackageDetailCard.tsx          -- (existing) Reused inside Account detail
|-- AddPackageModal.tsx            -- (existing) Reused from Pipeline/Accounts
|-- PackageWorkflowsEditor*.tsx    -- (existing) Reused
|-- CampaignSpecModal.tsx          -- (existing) Reused
```

### Chat context integration

When a work tab is open, Penny's LLM chat receives contextual awareness (following Suzi's `formatSuziWorkPanelContext` pattern):

| Tab | Context injected |
|-----|-----------------|
| Accounts (account selected) | "Viewing account [Company], [N] active packages, [N] contacts, health: [status], revenue: $[X]" |
| Accounts (no selection) | "Viewing account list: [N] customers, [N] prospects, [N] leads, [N] at risk" |
| Pipeline | "Viewing sales pipeline: [N] leads, [N] proposals, [N] in review, [N] customers, [N] delivered" |
| Health | "Viewing delivery health: [N] on track, [N] behind, [N] at risk, $[X] revenue at risk" |
| Products | "Viewing product board: [N] ideas, [N] ready, [N] published" |

### Wireframe: Accounts tab (selected account)

```
+-------------------+-------------------------------------------+
| Search...         |  Acme Corp                                |
|                   |  acme.com | linkedin.com/company/acme     |
| All Customers ... |  [CUSTOMER] 2 packages | $8,500 | 3 ppl  |
|                   |  [ + New package ] [ Draft update ]       |
| * Acme Corp       |                                           |
|   [CUSTOMER]      |  CONTACTS                                 |
|   2 active  [G]   |  Jane Smith (VP Marketing) - in outreach  |
|   3 contacts      |  Bob Jones (CEO) - replied                |
|                   |  Amy Lee (Dir Content) - onboarded        |
| o TechCo Inc      |                                           |
|   [PROPOSAL]      |  PACKAGES                                 |
|   1 draft   [-]   |  +-- Spotlight Package -- ACTIVE ------+  |
|   2 contacts      |  |  ############-------- 75%           |  |
|                   |  |  Scout research  ####-  80%         |  |
| o StartupXYZ      |  |  Ghost articles  ###--  60%         |  |
|   [LEAD]          |  |  Tim outreach    ####-  85%         |  |
|   0 packages [-]  |  +-------------------------------------+  |
|   1 contact       |                                           |
|                   |  +-- Content Boost -- ACTIVE ----------+  |
|                   |  |  ##########-------- 60%             |  |
|                   |  |  Marni posts     ##---  40%         |  |
|                   |  |  Ghost articles  ###--  65%         |  |
|                   |  +-------------------------------------+  |
+-------------------+-------------------------------------------+
```

### Wireframe: Pipeline tab (account kanban)

```
+----------+----------+----------+----------+----------+
|   Lead   | Proposal |  Review  | Customer | Delivered|
+----------+----------+----------+----------+----------+
|          |          |          |          |          |
| Startup  | TechCo   |          | Acme     | OldCo   |
| XYZ      | Inc      |          | Corp     | LLC     |
| 1 contact| 1 pkg    |          | 2 pkgs   | 1 pkg   |
| no pkg   | $3,000   |          | $8,500   | $2,000  |
|          | 5d       |          | ##--- 65%| done    |
|          |          |          |          |          |
|          | BigOrg   |          | DataFirm |          |
|          | Ltd      |          | Inc      |          |
|          | 2 pkgs   |          | 1 pkg    |          |
|          | $12,000  |          | $5,000   |          |
|          | 2d       |          | ####- 80%|          |
|          |          |          |          |          |
+----------+----------+----------+----------+----------+
```

### Wireframe: Health tab

```
+-------------------------------------------------------------+
|  Active accounts: 3   On Track: 2 (67%)   At Risk: 1       |
|                       Revenue at risk: $8,500                |
+-------------------------------------------------------------+
|                                                               |
|  +-- Acme Corp (2 packages) ------------- [!] At Risk ---+  |
|  |                                                        |  |
|  |  Spotlight Package                                     |  |
|  |  ######------------ 35%  (expected ~60% by now)        |  |
|  |  Scout research   ####-  80%  OK                       |  |
|  |  Ghost articles   #----  20%  <- stalled 12d           |  |
|  |  Tim outreach     ##---  40%                           |  |
|  |                                                        |  |
|  |  Content Boost                                         |  |
|  |  ############---- 75%  (expected ~70%)  OK             |  |
|  |  Last activity: 2 days ago                             |  |
|  +--------------------------------------------------------+  |
|                                                               |
|  +-- DataFirm Inc (1 package) -------- [OK] On Track ----+  |
|  |  LinkedIn Outreach                                     |  |
|  |  ############---- 80%  (expected ~75%)                  |  |
|  |  Last activity: 1 day ago                              |  |
|  +--------------------------------------------------------+  |
|                                                               |
+-------------------------------------------------------------+
```

---

## Convention changes required

### 1. Packages link to accounts (companies), not people

**Today:** UI paths (Friday package builder, `package_manager` tool) default `customerType` to `'person'`.

**Change:** When Penny creates a package for an account, use `customerType: 'company'` and set `customerId` to the `company.id`. Update:
- `FridayPackageBuilderModal.tsx` — offer company selection (not just person)
- `package_manager` tool — Penny's prompt should prefer company-level linking
- `agents/penny/system-prompt.md` — instruct Penny to think in terms of accounts

### 2. Account-aware package queries

**Today:** `GET /api/crm/packages?customerId=X` filters by UUID but doesn't care about `customerType`.

**Change:** No API change needed — the filter already works for both person and company UUIDs. The `GET /api/penny/accounts` endpoint handles the aggregation.

### 3. Tim's outreach provides lead signals

**Today:** When Tim reaches out to a person, their `companyId` is already stored.

**Change:** No data change — the `GET /api/penny/accounts` query already detects companies with people in outreach workflows as "leads." Tim doesn't need to do anything differently.

---

## Operating model (today's codebase)

| Step | Who / where | Mechanism |
|------|-------------|-----------|
| Draft package | Penny chat (`package_manager`) or **Friday -> Planner** | `create-package` with `customerType: 'company'` |
| Account link | Penny selects company | `customerId` -> `company.id` on `_package` |
| Submit for sign-off | Penny / Govind | `submit-for-approval` -> stage `PENDING_APPROVAL` |
| Approve & create workflows | Govind explicit phrase **"approve package"** | `approve-package` -> boards + `_workflow` rows, stage `ACTIVE` |
| Go live from UI | Package card | `POST /api/crm/packages/activate` with `targetStage: ACTIVE` |

**Friday** is the **ops hub** for **active** packages and templates; **Penny** is the **account-facing** owner of the customer relationship.

---

## Two package origination paths

Both paths produce the same `_package` row with `spec.commercial` and `spec.source`, flowing into identical delivery/health/margin tracking.

### Path 1: Custom / manual (P0 — primary)

The default path for bespoke service engagements, referrals, or any deal that doesn't fit a template. Uses the operating model above. `spec.source: { type: 'manual', referral: '...', notes: '...' }`. Billing is custom (`billingType: 'one-time' | 'monthly' | 'milestone' | 'custom'` with optional `billingNotes`). No Stripe or webhooks required — billing happens outside the system for now (manual invoice); King tracks margin.

### Path 2: Self-serve — Strattegys site + Stripe (P1)

- **Site:** Spotlight (or package) pages -> **Stripe Checkout**; Price/Product metadata maps to a **preset `PackageSpec`** (deliverables + brief) in Command Central.
- **Backend:** Verified **`checkout.session.completed`** webhook -> idempotent **`_package`** insert + **`spec.commercial`** from amount + **`spec.source`** `{ type: "stripe", sessionId, ... }` -> match/create CRM **company** + **person** by email -> **activate** (or hold for Govind review).
- **Penny:** Thank-you + onboarding at the **account** level (welcome the company, identify contacts, set expectations).

---

## Commercial / margin (intended — aligns with King)

**Gap today:** `_package.spec` has no standard **contract price**; `_usage_event` rarely carries **`packageId`** in metadata.

**Intended shape (spec-first, minimal schema churn):**

- Add optional `spec.commercial` (e.g. `contractPriceUsd`, optional `currency`, optional `internalCostBudgetUsd`).
- **Gate** "release": require `contractPriceUsd` (or explicit waiver) before `submit-for-approval`.
- **Attribute cost:** thread `packageId` into usage logging when chat/cron context includes a packaged workflow.
- **King:** per-account rollup (revenue from spec, cost from usage rows) -> **margin**; extend `cost_summary` / `/api/costs/summary` once wired.

---

## Automation principles (no duplicate orchestration)

- Prefer **package JSON** (`warmOutreachDiscovery`, `scoutTargeting`, future cadence blocks) over **new agent-specific crons** where possible.
- New **workflow types** only when a board shape is truly new; otherwise **deliverables + stageNotes + pacing** on existing types.
- **Products** use extended `PackageTemplateSpec` fields (Option A) — no new tables.
- **Account stage** is derived, not stored — no new columns.

---

## Implementation plan

### Phase 1 (P0 — workspace shell + Accounts + Pipeline)

1. [ ] Add `"penny-work"` to `CommandCentralRightPanel` and wire routing in `CommandCentralClient.tsx`.
2. [ ] Create `PennyWorkPanel.tsx` with tab bar (Accounts, Pipeline, Health, Products).
3. [ ] **New `GET /api/penny/accounts` endpoint** — company + package aggregation + lead detection from workflow items.
4. [ ] **Accounts tab:** Master-detail layout. Left: account list. Right: `PennyAccountDetailCard` with contacts + package cards + progress bars.
5. [ ] **Pipeline tab:** Account kanban with derived stage columns and account-level cards.
6. [ ] Update `defaultPanelForAgent` so Penny opens her workspace by default.
7. [ ] Wire chat context: `formatPennyWorkPanelContext`.
8. [ ] Update `FridayPackageBuilderModal` and `package_manager` tool to prefer `customerType: 'company'`.
9. [ ] Implement `spec.commercial` (`contractPriceUsd`) + validation on stage transitions.

### Phase 2 (P1 — Health + Products + onboarding)

10. [ ] **Health tab:** Delivery satisfaction dashboard with client-side health scoring at account level.
11. [ ] **Products tab:** Product board reading from extended `PackageTemplateSpec` with `productStage` field.
12. [ ] Penny onboarding flow: welcome sequence + intake questionnaire on package activation (account-level).
13. [ ] Friday heartbeat: package health check (compare workflow progress vs `targetCount`).
14. [ ] `GET /api/crm/directory/contacts?companyId=X` filter param for account contact list.

### Phase 3 (P2 — full lifecycle)

15. [ ] Account communication: status report generation per account (Penny drafts, human sends).
16. [ ] Satisfaction check-ins: cadence-driven prompts in Penny's work queue.
17. [ ] Close-out: automated delivery summary + `COMPLETED` transition trigger.
18. [ ] Renewal/upsell: "What's next?" flow when account's packages near completion.
19. [ ] Outbound email tool (Postmark) for account updates.
20. [ ] King: per-account P&L, invoicing.
21. [ ] Tim: `CONVERTED` stage signal back to Penny/King (creates/updates account).

---

## Next actions (checklist — consolidated)

1. [ ] **Penny workspace:** Shell routing + `PennyWorkPanel` + Accounts tab + Pipeline tab (Phase 1).
2. [ ] **`GET /api/penny/accounts`** endpoint with derived stage + aggregation.
3. [ ] Update `package_manager` tool + `FridayPackageBuilderModal` for `customerType: 'company'`.
4. [ ] Implement `spec.commercial` + validation on stage transitions.
5. [ ] Plumb `packageId` into `recordUsageEvent` / LLM usage metadata.
6. [ ] King: package-level cost summary + margin row.
7. [ ] **Stripe + site:** SKU <-> `PackageSpec` preset map; webhook -> provision package; Penny thank-you / onboarding.
8. [ ] **Health tab + Products tab** (Phase 2).

---

## Related repo references

- [`web/lib/package-types.ts`](../web/lib/package-types.ts) — `PackageSpec`, deliverables, templates
- [`web/lib/tools/package-manager.ts`](../web/lib/tools/package-manager.ts) — Penny/Friday tool (`customerType: person|company`)
- [`web/app/api/crm/packages/route.ts`](../web/app/api/crm/packages/route.ts) — package CRUD + `includeWorkflowBreakdown`
- [`web/app/api/crm/packages/progress/route.ts`](../web/app/api/crm/packages/progress/route.ts) — per-package progress
- [`web/app/api/crm/packages/activate/route.ts`](../web/app/api/crm/packages/activate/route.ts) — activation + agent tasks
- [`web/app/api/crm/directory/contacts/route.ts`](../web/app/api/crm/directory/contacts/route.ts) — CRM contacts with package data
- [`web/app/api/crm/directory/companies/route.ts`](../web/app/api/crm/directory/companies/route.ts) — CRM company list
- [`web/lib/warm-contact-intake-apply.ts`](../web/lib/warm-contact-intake-apply.ts) — `resolveOrCreateCompanyId`
- [`agents/penny/system-prompt.md`](../agents/penny/system-prompt.md) — Penny chat behavior
- [`docs/AGENT_UI_ARCHITECTURE.md`](AGENT_UI_ARCHITECTURE.md) — Penny workspace routing
- [`web/lib/command-central-url.ts`](../web/lib/command-central-url.ts) — Shell panel routing
- [`web/app/CommandCentralClient.tsx`](../web/app/CommandCentralClient.tsx) — Component mount tree
