# Car rental vertical: development plan

Goes with [architecture.md](./architecture.md) and [booking-flow.md](./booking-flow.md). Sizes are
in weeks for **2–3 engineers working with coding agents**. They are planning estimates, not
commitments. Each phase follows the repo's existing release rule: one branch per phase
(`cars/phase-cN`, from the previous phase), a Vercel preview on staging, owner QA, then a PR into
`main`.

Revised 10 Nov 2026 after the booking research. The changes:
- the configuration engine moves to the front;
- the booking flow gets its own phase;
- delivery and collection, monthly rentals, brokers and corporate accounts are in scope before the
  pilot.

**Ground rules for every phase**
- Events keeps its own flow and keeps working on every merge. The e2e scripts, DB tests and Odoo
  parity (`pnpm --filter @rental/core parity`, 150/150) must stay green.
- New code goes into the module layout (`contract/ domain/ app/ infra/ ui/`). The boundary check
  runs in CI from C0 onward.
- **Nothing car-specific is hard-coded if a business could want it different.** It goes through the
  settings registry or the rules engine, and gets a preset value.
- Every money path has golden-case tests. Every invariant that can race has a concurrency test.
- Feature flags are per tenant and per module (they extend `tenants.rollout_phase`). Car tenants stay
  in early access until the pilot.

---

## Timeline at a glance

```
week    1    4    8    12   16   20   24   28   32   36   40
C0   ████████                                            foundations + config/rules kernel + shared header
C1           ████████                                    fleet, catalog, rates, policies, presets, rule bench
C2                   ██████████                          booking core: spike, availability levels, reservation, gates, counter
C3                         ██████                        payments, deposits, ledger, tax invoices, GCC gateway
C4                               ████████                drivers & documents & KYC, agreement, website + portal
C5                                       ████████        hand-over & return, delivery/collection, settlement
C6                                               ██████████  monthly, corporate, insurance replacement, channel hub
C7                                                       ██████ tolls, fines, maintenance → PILOT (1 US + 1 Dubai)
C8           ···········████████████████████████         agents (parallel; reservation agent after C4)
C9           ··········██████████                        ME cell, residency, e-invoicing (parallel)
C10                                                   ▶  GA hardening
```

---

## C0 · Foundations (≈ 4 weeks)

**Goal:** add seams and the configuration kernel without changing event behaviour.

1. **Kernel package** (moved from `@rental/core`; `core` re-exports, so events code does not change):
   - `Money` with ISO 4217 exponents (USD, AED, QAR, OMR, SAR, KWD, BHD) and one rounding module;
   - a lint rule against `/100` and `*100` outside the kernel;
   - `COUNTRY_DEFAULTS` for QA and OM;
   - branch calendars (weekend days per country, seasons);
   - contract helpers `defineCommand`, `defineQuery`, `defineEvent` (zod, version, permission, risk,
     dryRun).
2. **Configuration kernel** ([booking-flow.md §4–5](./booking-flow.md#4-rules-engine-how-everything-configurable-works)):
   - `defineSetting` registry;
   - scoped resolution with provenance;
   - `platform.settings_values` (versioned, `effective_from`);
   - rules as data (`platform.rules`), with a pure evaluator: facts, effects, conflict resolution,
     locked jurisdiction rules and bounds;
   - `platform.policy_snapshots` (content-addressed).

   Existing tenant and location settings keep working through an adapter.
3. **Approvals inbox** (`platform.approvals`), one queue for human rule approvals and agent proposals.
4. **Shared order header** (architecture §6.0):
   - `orders` gains `vertical`, `stage`, `bill_to_party_id` and `payer_kind`, plus
     `unique (tenant_id, id, vertical)`;
   - the `VerticalAdapter` registry, with events registered first;
   - the lint rule against `vertical ===` in platform code;
   - a schema check on header columns.
5. **Outbox and inbox** tables, the relay in the worker, and named queues (`critical`, `messaging`,
   `projections`, `reports`, `ai`). First strangled coupling: `orders` emits `OrderBooked`,
   `QuoteSent` and `OrderCancelled`, and messaging subscribes. Idempotency keys are unchanged.
6. **Boundaries in CI:**
   - `dependency-cruiser` rules;
   - `exports` maps;
   - a Postgres schema per new context;
   - `AGENTS.md` per context.
7. **Tenancy and roles:**
   - `tenants.verticals text[]` and `home_cell`;
   - **roles per vertical** on memberships (events: coach, crew; cars: counter agent, fleet manager,
     yard, damage assessor, chauffeur, dispatcher);
   - **membership kind** `staff` | `partner`, with an RLS **partner scope** (`app.partner_id`) beside the
     location scope, plus tests that a partner sees only their own records
     ([service-modes.md §4](./service-modes.md#4-access-model-change-partner-memberships));
   - the register page's `?vertical=cars` path creates a cars early-access workspace.
8. **i18n base:**
   - the ICU catalog is wired in;
   - `dir` on `<html>`;
   - the kit (`components/kit`) is converted to logical properties;
   - kit and shell strings are extracted first.
9. **Observability:** OpenTelemetry traces for actions, the worker and SQL. Error reporting. SLO
   dashboards.

**Exit:**
- All event e2e scripts, DB tests and parity pass.
- The boundary check is green.
- The rule evaluator and settings resolver have property tests (deterministic results, locked rules
  can't be loosened).
- One event flows through the outbox.
- The kit renders correctly in `ar` (RTL screenshot test).

## C1 · Fleet, catalog, rates, policies, presets (≈ 4 weeks)

- **Fleet:**
  - classes (ACRISS, tags, **booking level** class / model / vehicle, upgrade ladder);
  - models;
  - vehicles (VIN check digit, plate + emirate/state, registration and insurance expiry, Salik tag,
    odometer, home branch, photos, status lifecycle);
  - CSV import;
  - document expiry alerts.
- **Branches:**
  - type (airport, city, delivery-only);
  - opening hours, after-hours rules;
  - **delivery zones** (polygons, fee rules, lead time, slots);
  - one-way matrix.
- **Catalog:**
  - extras (tracked, such as child seats, or untracked; per day, per rental, or capped);
  - protection packages (CDW/SCDW/PAI, excess amounts);
  - mileage plans, fuel options (full-to-full, same-to-same, prepaid), cross-border products
    (country, eligible vehicles, NOC template).
- **Rate engine** (pure):
  - billable periods (24 h + grace) and best-of day/week/month;
  - seasons and weekend days from the branch calendar;
  - LOR tiers; km allowance and excess;
  - fees (airport, delivery, one-way, after-hours, young driver, extra driver);
  - **monthly/subscription plans**;
  - tax through the `TaxEngine` port (AE/OM 5% VAT, QA none, US multi-component).
- **Policies** as versioned objects: cancellation tiers, no-show, modification and repricing,
  deposit (strategy, amount, release days, no-deposit surcharge), late return (grace, hourly
  threshold, rules for extras).
- **Jurisdiction packs** (AE, AE-DU, AE-SHJ, QA, OM, US + states) with locked legal rules.
  **Presets:** Dubai standard, Dubai luxury, Monthly UAE, Doha, Muscat, US airport, US neighborhood.
- **Settings UI generated from the registry**, plus the **rule test bench** with saved test cases.

**Exit:**
- The golden suite prices 40+ scenarios to the minor unit in USD, AED, QAR and **OMR**. Examples:
  - a 9-day rental where the weekly rate wins;
  - a Dubai Marina delivery, free over 3 days;
  - a monthly plan with excess km;
  - a one-way with an airport fee and VAT.
- The bench explains every rule that fires.
- A locked rule cannot be loosened.
- Reference cases **R1–R13** from [market-reference.md](./market-reference.md) pass as saved bench
  tests for the presets.

## C2 · Booking core (≈ 5 weeks)

1. **Spike (weeks 1–2):** a thin car reservation → deposit → invoice → refund → report on the shared
   header. Any `vertical` branch needed in shared code, or any car column needed on the header,
   counts as a finding and gets fixed before going further.
2. **Availability:**
   - class strategy (advisory lock, overbooking allowance, upgrade ladder);
   - model strategy;
   - vehicle strategy (`EXCLUDE USING gist` on `vehicle_blocks`);
   - one-way supply, turnaround buffers, maintenance blocks;
   - **overdue rentals keep their car blocked**, with at-risk flags;
   - tracked extras use the pooled strategy.
3. **Reservation aggregate:**
   - parties (hirer, primary and additional drivers, contacts, bill-to, booker);
   - pickup and return modes (branch, delivery, airport + flight);
   - state machine (Draft → Held → PendingApproval → Confirmed → Ready → OnRent; Expired, Declined,
     Cancelled, NoShow);
   - **gates A/B/C and the computed readiness checklist**;
   - policy snapshot at confirm;
   - hold expiry and no-show jobs (flight-delay-aware grace);
   - versions and audit.
4. **Commands with dry run:** `search.offers`, `hold`, `update`, `confirm`, `modify`, `cancel`,
   `markNoShow`, `readiness`. Every one returns the explained quote and the checklist.
5. **Staff counter builder:**
   - one screen with a "Still required" sidebar;
   - phone/email lookup;
   - live quote;
   - approvals in place.
6. **Fleet calendar:** a virtualized Gantt by vehicle and class, with drag to assign or swap, at-risk
   and overdue markers.
7. **Flow definitions per channel** (staff first). Tenant custom fields with show-if rules.

**Exit:**
- A concurrency test (50 parallel holds for the last car) produces exactly 1 success.
- A vehicle-level double hold is rejected by the database.
- An overdue return correctly blocks the next booking.
- A counter booking for a returning customer takes ≤ 90 s in an e2e timing run.
- Commit p95 ≤ 250 ms.

## C3 · Payments, deposits, ledger, tax invoices (≈ 3 weeks, overlaps C2)

- **`PaymentGateway` port with capability flags.** The current Stripe code moves behind it with no
  change for events. Add authorize / increment / capture / void and merchant-initiated charges.
- **First GCC adapter** (decision D1, confirmed with the provider for AE, QA and OM onboarding and
  auth holds).
- **Payment options:**
  - pay now (full or partial);
  - pay at pickup with a card guarantee or without;
  - broker prepaid;
  - corporate invoice with credit limit;
  - cash (counter only).
- **Deposit strategies:** `auth_hold` with re-auth, `charge_and_refund` with a release window,
  `no_deposit` with a surcharge, `none`.
- **Cancellation and no-show fees** from the locked policy, charged on the guaranteed card.
- **Ledger** per order (customer, broker and corporate receivables, deposit liability, revenue, VAT,
  pass-throughs). Reconciliation of ledger = gateway.
- **Immutable tax invoices + credit/debit notes:**
  - bilingual EN/AR with TRN;
  - **bill-to** a customer, company or broker;
  - VAT-inclusive display for UAE consumers;
  - events moves to issue-and-credit-note behind a flag.

**Exit:**
- The money lifecycle in AED and OMR reconciles to the minor unit for each payment option, including
  a no-show fee and a broker booking with counter extras.
- Issued invoices cannot change (DB trigger + test).

## C4 · Drivers, documents, KYC, agreement, customer channels (≈ 4 weeks)

- **Driver profiles and identity documents:**
  - catalog per jurisdiction;
  - field-level encryption + keyed hash;
  - private storage, retention purge;
  - expiry vs `return_at` + buffer.
- **Declared vs verified facts.** The hand-over gate accepts **verified only**.
- **Document scan prefill** (MRZ/OCR, through the KYC vendor or the extraction agent with a person
  confirming).
- **KYC adapter** (D5). UAE Pass later.
- **Manual verification screen** for staff, with a permission. A soft blacklist hit goes to approval;
  a hard hit is denied.
- **Agreement:**
  - tenant-edited, versioned, bilingual;
  - e-signature (reuse `signatures`);
  - which drivers must sign (setting);
  - consent for post-rental charges;
  - cross-border NOC generated when bought.
- **Website booking widget** (≤ 4 screens to confirm, instant eligibility pre-check from declared
  facts).
- **Customer portal "complete your booking"** link: documents, extra drivers, sign, pay.
- **Reminders** until the booking is `ready_for_pickup` (messaging; email, SMS and WhatsApp
  templates).
- **Meta messaging inbox (staff-operated):** WhatsApp first, then Instagram and Messenger. Templates,
  Flows for search and quote, payment links, secure upload links. **ID photos in chat are never
  stored** (guardrail, reference case R6). The AI reservation agent joins the same inbox in C8.

**Exit:**
- An unverified or ineligible driver cannot pass hand-over (domain + DB test).
- A web booking → portal completion → ready works end to end on a phone, in EN and AR.
- ≥ 70% of test-pilot bookings reach "ready" before pickup day in a staging dry run.

## C5 · Hand-over & return, delivery & collection, settlement (≈ 4 weeks)

- **The coach portal PWA becomes a shared field-app shell:**
  - offline queue and background photo upload;
  - client-side resize (reuse `shrink-image`);
  - GPS stamp.
- **Check-out** (Gate C → agreement opened):
  - VIN/plate confirm;
  - guided walk-around photos;
  - tap-to-mark damage diagram;
  - fuel/SoC and odometer;
  - customer signs the condition report;
  - keys handed.
- **Delivery and collection tasks** reuse crew dispatch and the live map: time window, route, proof
  of hand-over at the address.
- **Check-in** with side-by-side pickup photos, new damage and readings. **Settlement** (pure):
  - extra km and fuel;
  - late return with separate grace for extras;
  - cleaning;
  - confirmed damage capped by excess;
  - deposit capture and release;
  - receipt with photos.
- **Extensions, early returns and vehicle swaps** run from the portal and staff app, re-checked
  against availability under the locked terms or the repricing setting.
- **Yard board:** due out and due in, late, ready vs incomplete, prep queue, deliveries.
- **Chauffeur and transfer modes** ([service-modes.md](./service-modes.md)):
  - the chauffeur staff resource (shifts, rest rules, credentials);
  - two-resource availability;
  - packages, overtime and waiting pricing;
  - zone-matrix transfers;
  - dispatch board (shared with delivery);
  - chauffeur job flow in the field app;
  - tolls and fines routed to the job (reference case R13).

**Exit:**
- Check-out ≤ 2 min for a ready booking on a mid-range phone, offline-capable.
- Settlement golden suite passes.
- Deposit release is automatic after a clean return.

## C6 · Monthly, corporate, insurance replacement, channel hub (≈ 5 weeks)

- **Monthly/subscription:**
  - recurring invoices per cycle;
  - auto-charge;
  - km per cycle with excess;
  - scheduled service swaps;
  - notice period and auto-renew settings.
- **Corporate accounts:**
  - company party, negotiated rate plans, credit limit;
  - authorised drivers and bookers;
  - PO required (setting);
  - monthly statement;
  - corporate portal flow.
- **Insurance replacement** ([service-modes.md §2](./service-modes.md#2-insurance-replacement)):
  - insurer accounts (rates per class, default days, references, terms);
  - authorisation intake (portal, staff, email draft);
  - delivery to the body shop;
  - extension approvals in the shared inbox;
  - **split billing** (insurer + customer) and receivables aging per insurer;
  - **partner portal** for adjusters, body shops, hotels/referrers and corporate bookers.
- **Channel hub** ([channels.md](./channels.md)):
  - the platform `distribution` context, the adapter capability model and per-channel settings
    (scope, content, rates, allotments, policies, acceptance, money, customer ownership, tracking);
  - ingest, idempotent upserts, throttled pushes, conflict queue, daily reconciliation, health and
    kill switch.
  - Connectors, in order:
    1. Meta CAPI + catalog feed;
    2. OneClickDrive lead capture;
    3. Turo/Getaround iCal + booking-email parsing;
    4. OTA XML supplier endpoint certified with **one** broker or aggregator the pilots use;
    5. Google Business Profile links + schema.org.
  - Brokers: broker accounts (net vs gross, commission), voucher bookings, counter collection of
    deposit and extras, broker receivable in the ledger.

**Exit:**
- 3 monthly cycles simulated with excess km and a swap reconcile.
- Reference cases R14 (insurance split), R15 (broker voucher) and R16 (Turo import, no duplicate on
  resend) pass end to end.
- An adapter outage doesn't lose bookings: replay from ingest succeeds, and the conflict queue
  catches any oversell.

## C7 · Tolls, fines, maintenance → pilot (≈ 3 weeks)

- **Post-rental charges:**
  - Salik and Darb statement import (VAT on Salik per current rules);
  - police and RTA fines for Dubai, Sharjah and Abu Dhabi, Qatar MOI, Oman ROP;
  - US toll and partner files;
  - match by plate + instant, with an exceptions queue;
  - admin fee and tax;
  - collect from deposit or merchant-initiated charge;
  - notice with evidence, disputes, closing window.
- **Maintenance:** plans by km or date, work orders, blocks, registration and insurance expiry alerts.
- **Reports:** utilization, revenue per available unit, by class and branch, no-show rate per channel
  (feeds the overbooking allowance), damage and fine recovery, readiness rate.
- **Pilot:** **1 US + 1 Dubai** operator, with real past bookings imported for presets and golden
  cases.

**Exit:**
- Pilots run real rentals for 4 weeks.
- ≥ 95% of toll lines auto-match.
- No double charges (an idempotency key per statement line).

## C8 · Agents (parallel track, starts after C0)

1. **Platform** (with C1–C2):
   - `agent_principals`, autonomy levels, kill switches;
   - the tool gateway generated from contracts, with risk classes and policy;
   - proposals use the **same approvals inbox**;
   - run logging with cost, budgets, subject binding (OTP);
   - eval harness in CI (EN/AR, adversarial);
   - the `ai-anthropic` adapter with per-cell model routing;
   - an MCP server with scoped keys.
2. **Agents, in order:**
   1. Ops copilot (read-only).
   2. **Document extraction assistant** (MRZ/OCR proposals, with a person confirming).
   3. **Reservation agent** on web chat, then in the **Meta inbox** (WhatsApp, Instagram,
      Messenger), after C4. Same flow definition. Payment and document upload by secure link only.
      Hand-off to a person is configurable.
   4. **Readiness/KYC chaser.**
   5. Fines & tolls matcher.
   6. Damage assistant (L0/L1 only).
   7. Fleet & yield advisor: overdue swaps, repositioning, overbooking suggestions.
   8. Collections.

**Exit:**
- 0 policy violations in the adversarial suite.
- Every agent action is traceable to the audit log.
- The reservation agent books correctly in ≥ 95% of eval conversations.

## C9 · ME cell, residency, e-invoicing (parallel track)

- Decision D2, then the `me-central` cell as infrastructure-as-code: DB primary + replica, pooler,
  in-region storage, KMS, worker, ingest, backups and point-in-time recovery, and a restore drill.
- **Control plane:** slug → cell directory, edge routing, per-cell auth, a cross-cell console, and
  the tenant move runbook (`copy-tenant.ts`).
- **Legal:** PDPL/PDPPL/Oman PDPL review (D3), retention settings, subprocessors per cell.
- **E-invoicing adapters:** UAE PINT AE (ASP), Oman Fawtara.

**Exit:**
- A Dubai workspace's data and AI calls stay in the ME cell.
- p95 page response from Dubai ≤ 300 ms.
- An ASP sandbox accepts a test invoice.

## C10 · GA hardening (≈ 3 weeks, then ongoing)

- Migration importers (HQ, Rent Centric, generic CSV). Accounting exports (QuickBooks, Xero, Zoho
  Books). Public API and webhook docs.
- Telematics adapter (Smartcar or Teltonika): odometer and fuel at check-out and check-in
  automatically, and geofence alerts (including crossing into Oman without a cross-border product).
- **Backlog:** chauffeur-driven rentals, insurance-replacement bookings, rideshare-driver weekly
  rentals (US), broker APIs at scale, BNPL (Tabby/Tamara), keyless self-service pickup.
- Load test at 10× pilot volume. Chaos drill. Pen test.

---

## Test strategy (all phases)

| Layer | What | Where |
| --- | --- | --- |
| Domain unit | rate engine, settlement, rule evaluator, settings resolver, state machines, readiness | `domain/*.test.ts` (vitest) |
| Property tests | rule conflict resolution is deterministic; locked rules can't be loosened; snapshot hashing is stable | kernel |
| Golden cases | real past bookings per market (USD, AED, QAR, OMR) priced to the minor unit | `cars/rates/tests/golden` |
| Tenant rule tests | each tenant's saved rule-bench cases run on every rule change | Settings + CI for presets |
| Contract | command and event schemas and versions; consumers checked against producers | `contract/*.test.ts` |
| DB integration | RLS as `rental_app`, exclusion constraints, lock races, header ↔ detail integrity trigger, invoice immutability | PG17 CI service |
| Concurrency | parallel holds, double-assign, simultaneous captures, overdue blocking | dedicated suite |
| E2E | counter, web, portal, field app; desktop 1440 + phone 390 + **RTL `ar`**; timing assertions (≤ 90 s counter) | `apps/web/scripts/e2e-cars-*.mjs` |
| Agent evals | golden + adversarial + multilingual; policy-violation rate must be 0 | CI gate |
| Performance | search + quote p95, commit p95, field app offline | staging traces |

## Decisions needed from the owner

D1 GCC gateway · D2 ME cell hosting · D3 Qatar/Oman residency · D4 default deposit strategy · D5 KYC
vendor · D6 incremental events migration (recommended) · D7 pilot tenants and past bookings · D8
shared header (decided, spike in C2) · D9 booking-flow questions · D10 channel hub as a platform context
([booking-flow.md §12](./booking-flow.md#12-open-questions-for-the-owner)).
