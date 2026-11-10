# Car rental vertical: development plan

Goes with [architecture.md](./architecture.md). Sizes are in weeks for **2–3 engineers working with
coding agents**. They are planning estimates, not commitments. Each phase follows the repo's existing
release rule: one branch per phase (`cars/phase-cN`, from the previous phase), a Vercel preview on
staging, owner QA, then a PR into `main`.

**Ground rules for every phase**
- Events keeps working on every merge. The e2e scripts, DB tests and Odoo parity
  (`pnpm --filter @rental/core parity`, 150/150) must stay green.
- New code goes into the module layout (`contract/ domain/ app/ infra/ ui/`). The boundary check
  runs in CI from Phase C0 onward.
- Every money path has golden-case tests. Every invariant that can race has a concurrency test.
- Feature flags are per tenant and per module (they extend `tenants.rollout_phase`). Car tenants stay
  in early access until C6.

---

## Timeline at a glance

```
week   1    4    8    12   16   20   24   28   32
C0  ████████                                      foundations (refactor, kernel, outbox, i18n base)
C1          ██████                                fleet & rates
C2                ████████                        availability & reservations, widget
C3                ██████                          payments port, GCC gateway, deposits, ledger, tax invoices
C4                        ██████                  drivers & KYC, agreement
C5                              ████████          field app: check-out / check-in, settlement
C6                                      ██████    tolls, fines, maintenance  → pilot (1 US + 1 Dubai)
C7          ················████████████████      agent platform + agents (parallel track)
C8          ··········██████······                ME cell, residency, e-invoicing (parallel track)
C9                                            ███ GA hardening, migration importers, channels
```

---

## C0 · Foundations (≈ 4 weeks)

**Goal:** add seams without changing behaviour.

1. **Kernel package** (moved from `@rental/core`; `core` re-exports so events code does not change):
   - `Money` with ISO 4217 exponents (USD, AED, QAR, OMR, SAR, KWD, BHD) and one rounding module;
   - a lint rule against `/100` and `*100` outside the kernel;
   - `COUNTRY_DEFAULTS` for QA and OM;
   - branch calendars (weekend days per country, seasons);
   - contract helpers `defineCommand`, `defineQuery`, `defineEvent` (zod, version, permission, risk,
     dryRun);
   - a pure policy evaluator (the shape of `permissions.ts`).
2. **Outbox and inbox.**
   - Tables `outbox(id, tenant_id, context, type, version, payload, occurred_at, published_at)` and
     `inbox(consumer, event_id)`, both under RLS.
   - A relay in the worker (LISTEN/NOTIFY + poll).
   - Named queues: `critical`, `messaging`, `projections`, `reports`, `ai`.
3. **Strangle the first coupling.** `orders` emits `OrderBooked`, `QuoteSent` and `OrderCancelled`.
   Messaging subscribes instead of being called. Message idempotency keys are unchanged, and
   behaviour is identical in the e2e scripts.
4. **Boundaries in CI.**
   - `dependency-cruiser` rules from architecture §5.
   - `exports` maps on new packages.
   - Postgres schema per new context.
   - `AGENTS.md` per context.
5. **Tenancy.**
   - `tenants.verticals text[]` and `tenants.home_cell`.
   - The register page's existing `?vertical=cars` path creates a cars-enabled early-access workspace.
   - Role sets per vertical: cars adds `counter_agent`, `fleet_manager`, `yard` (jockey/driver) and
     `damage_assessor`. Coach and crew stay events-only.
6. **i18n base.**
   - The ICU message catalog is wired in.
   - `dir` on `<html>`.
   - The component kit (`components/kit`) is converted to logical properties.
   - English strings are extracted for the kit and shell first.
7. **Observability.** OpenTelemetry traces for server actions, the worker and SQL. Error reporting.
   SLO dashboards for the budgets in architecture §8.

**Exit:**
- All existing e2e scripts, DB tests and parity pass.
- The boundary check is green.
- One event flows through the outbox to messaging in production.
- The kit renders correctly in `ar` (RTL screenshot test).

## C1 · Fleet & rates (≈ 3 weeks)

- **Fleet:**
  - vehicle classes (ACRISS code, seats, bags, transmission, fuel/EV, minimum age, deposit policy);
  - vehicles (VIN check digit, plate + emirate/state, registration and insurance expiry, Salik tag
    id, odometer, home branch, status lifecycle);
  - CSV import;
  - documents with expiry alerts.
- **Branches:** reuse locations, plus branch type (airport / city / delivery-only), opening hours,
  after-hours return, and delivery zones (polygons) with fees.
- **Rate engine** (pure, `cars/rates/domain`):
  - billable periods (24 h + grace) and best-of day/week/month;
  - seasons and weekend days from the branch calendar;
  - LOR tiers, included km and excess rate;
  - extras (per day, capped, or per rental), protection products (CDW/SCDW/PAI with excess);
  - fees (airport, one-way, delivery, young driver);
  - tax components through the `TaxEngine` port (VAT 5% for AE and OM; Qatar none; US multi-component).
- **Staff UI:** fleet list, vehicle page, classes, rate plans and extras editor.

**Exit:**
- The golden suite prices 30+ scenarios to the minor unit in USD, AED, QAR and **OMR (3 decimals)**,
  including a 9-day rental where the weekly rate wins and a one-way with airport fee and VAT.
- The engine runs in the browser.

## C2 · Availability & reservations (≈ 4 weeks)

- **Availability engine:**
  - the existing pooled strategy is wrapped;
  - add the `class` strategy (advisory lock per tenant + class + branch, one-way supply projection,
    turnaround buffers);
  - add the `serialized` strategy: `vehicle_blocks` with
    `EXCLUDE USING gist (tenant_id WITH =, vehicle_id WITH =, period WITH &&)`;
  - maintenance and transfer blocks.
- **Reservation aggregate** and its state machine (Quoted → Reserved → Confirmed → OnRent → Returned
  → Settled → Closed; NoShow, Cancelled, Expired). Hold expiry runs as a scheduled job. Prices are
  locked on confirmation (reusing the price-lock pattern). Versions and audit are recorded.
- **Staff reservation builder:** class picker with live availability and quote, extras, drivers,
  pickup and return branch and time. **Fleet calendar** (virtualized Gantt by vehicle and class with
  drag to assign or swap) is the view the marketing page already shows.
- **Late VIN assignment:** a pure solver suggests a VIN and staff can override.
- **Public booking widget + portal:**
  - a `class_availability` projection with a short cache;
  - pages are static plus a JSON API;
  - booking widget pages: quote, then reserve, then pay link (C3).

**Exit:**
- A concurrency test (50 parallel bookings for the last car) produces exactly 1 success.
- No double VIN assignment is possible (the database rejects it).
- Widget availability + quote p95 ≤ 400 ms on a 1,000-vehicle seed.

## C3 · Payments, deposits, ledger, tax invoices (≈ 3 weeks, parallel with C2)

- **`PaymentGateway` port with capability flags.** The current Stripe code (`@rental/payments`)
  moves behind it with no behaviour change for events.
- Add authorize / increment / capture / void and merchant-initiated charges.
- **First GCC adapter.** Which one depends on decision **D1** (merchant onboarding in AE, QA and OM,
  plus auth-hold support, confirmed with the provider).
- **Deposit strategies:**
  - `auth_hold` with automatic re-auth before expiry (`critical` queue);
  - `charge_and_refund` with a configurable retention window;
  - `none`.
- **Ledger** per agreement (double-entry-lite) and reconciliation of ledger = gateway (extends
  today's `reconcile_payments`).
- **Immutable tax invoices + credit/debit notes:**
  - bilingual EN/AR print template with TRN and the words "Tax Invoice";
  - per-branch numbering (exists);
  - VAT-inclusive display for consumers in the UAE.
- **Events tenants:** move from "re-sync invoices" to issue-and-credit-note behind a flag. Parity of
  totals is unchanged.

**Exit:**
- A full money lifecycle in AED and OMR (hold, capture part, release rest, refund, post-rental
  charge) reconciles to the minor unit against the gateway sandbox.
- No issued invoice can be updated (DB trigger + test).

## C4 · Drivers, KYC, agreement (≈ 3 weeks)

- **Driver profiles:** licences (country, class, expiry), ID (Emirates ID, QID, passport, visa
  type), DOB, additional drivers.
- **Field-level encryption** and private storage. ID images are purged on schedule.
- **KYC adapter** (decision **D5**). The portal upload flow (phone camera) and verification results
  arrive as webhooks.
- **Eligibility rule packs** are versioned data: UAE (resident vs visitor licence or IDP), Qatar,
  Oman and US states. Tenant overrides cover minimum ages per class and young-driver surcharges. The
  pure evaluator explains every rejection.
- **Rental agreement:**
  - tenant-edited, versioned and bilingual text;
  - e-signature (reuse `signatures`: exact text, version, IP, UA);
  - consent for post-rental charges on the saved card;
  - cross-border clause (UAE → Oman requires insurance extension).

**Exit:**
- An ineligible driver cannot be put on an agreement (domain + DB test).
- KYC → eligibility → sign works end to end in a phone e2e run, in EN and AR.

## C5 · Field app: check-out, check-in, settlement (≈ 4 weeks)

- **The coach portal PWA becomes a shared field-app shell:**
  - offline queue (IndexedDB) and background photo upload with presigned URLs and retry;
  - client-side resize (reuse `shrink-image`);
  - GPS stamp.
- **Check-out:** VIN/plate scan or confirm, guided walk-around (8–12 photo angles), tap-to-mark
  damage diagram (zones exist on the marketing page), fuel/SoC, odometer, customer signature on the
  condition report, keys handed.
- **Check-in:** the same flow with side-by-side pickup photos, new-damage marking and readings.
- **Settlement** (pure `settle()`): extra km, fuel or charge, late return, cleaning, confirmed damage
  (capped by protection excess), then deposit capture and release, and a receipt with photos.
- **Extensions and early returns** run from the portal and staff app, re-checked against
  availability and re-quoted under the price lock.
- **Yard board:** due out, due in, late, prep queue (cleaning, refuel), blocked vehicles, delivery
  and collection runs (reuses the crew dispatch and live map).

**Exit:**
- A check-out takes ≤ 2 minutes on a mid-range phone with throttled 3G and works offline.
- Settlement golden suite passes.
- A deposit is released automatically after a clean return.

## C6 · Tolls, fines, maintenance → pilot (≈ 3 weeks)

- **Post-rental charges:**
  - statement import (Salik and Darb CSV/Excel, police and RTA exports for Dubai, Sharjah and
    Abu Dhabi, Qatar MOI, Oman ROP, and US toll or partner files);
  - mapping templates per source;
  - match by plate + instant;
  - exceptions queue;
  - admin fee and tax treatment through the tax engine;
  - collection from deposit or merchant-initiated charge;
  - customer notice with evidence;
  - dispute workflow;
  - a closing window per tenant.
  An API adapter is added only where an official API is confirmed.
- **Maintenance:**
  - plans by km or date;
  - work orders and vendors;
  - due and overdue items block availability;
  - registration and insurance expiry alerts (extends `maintenance_tickets`).
- **Reports:** utilization, revenue per available unit, revenue by class and branch, damage and fine
  recovery rate, fleet age. Exported and scheduled (reuses the reports module).
- **Pilot:** onboard **1 US + 1 Dubai** operator in early access, with a migration import from
  CSV/Excel or their current RMS export.

**Exit:**
- The pilot tenants run real rentals for 4 weeks.
- ≥ 95% of toll lines auto-match.
- Nothing is double-charged (idempotency keys per statement line).

## C7 · Agent platform and agents (parallel track, ≈ 10 weeks, starts after C0)

1. **Platform** (weeks 1–4):
   - `agent_principals`, autonomy levels and kill switches (tenant and platform console);
   - the tool gateway generated from contracts, with risk classes and policy evaluation;
   - the **proposals inbox** (diff + reason + evidence, one-click approve);
   - `agent_runs` and `agent_steps` logging with cost;
   - budgets and rate limits;
   - subject binding (OTP) for customer channels;
   - eval harness (golden and adversarial cases, EN/AR) wired into CI;
   - the `ai-anthropic` adapter with per-cell model routing;
   - an **MCP server** in `apps/api` with per-key scopes.
2. **Agents, rolled out in this order** (each goes shadow → L1 → L2 per tenant on measured precision):
   1. Ops copilot (read-only, staff).
   2. Reservation agent: web chat, then WhatsApp.
   3. KYC chaser.
   4. Fines & tolls matcher (back office).
   5. Damage assistant (L0/L1 only).
   6. Fleet & yield advisor (proposals only).
   7. Collections.
3. The **events vertical** gets the same agents where they fit (quote agent, ops copilot) at no extra
   platform cost.

**Exit:**
- No agent can execute a command its policy denies (adversarial eval suite at 100%).
- Every agent action is traceable from the audit log to the run step.
- The reservation agent books correctly in ≥ 95% of eval conversations with zero policy violations.

## C8 · ME cell, residency, e-invoicing (parallel track, ≈ 5 weeks)

- Decision **D2**, then provision the `me-central` cell as infrastructure-as-code: PG17 primary +
  replica, pooler, in-region object storage, KMS, worker, ingest, backups and point-in-time
  recovery, plus a restore drill.
- **Control plane:**
  - workspace directory (slug → cell) with signed cache;
  - edge routing;
  - per-cell auth;
  - platform console across cells;
  - a tenant move runbook built on `copy-tenant.ts`.
- **Legal and compliance:**
  - PDPL/PDPPL/Oman PDPL review (D3);
  - processing records;
  - retention settings;
  - subprocessor list per cell.
- **E-invoicing adapters:**
  - UAE PINT AE through an Accredited Service Provider (needed by 1 Jul 2027 for most tenants, and by
    1 Jan 2027 for revenue ≥ AED 50m);
  - Oman Fawtara (track the revised dates);
  - status shown on the invoice.

**Exit:**
- A Dubai workspace's data (DB, files, backups, AI calls) stays in the ME cell.
- p95 page response from Dubai ≤ 300 ms.
- A test e-invoice is accepted by the ASP sandbox.

## C9 · GA hardening (≈ 3 weeks, then ongoing)

- Migration importers (HQ, Rent Centric and generic CSV), accounting exports (QuickBooks, Xero,
  Zoho Books), public REST API + webhooks docs.
- Telematics adapter: Smartcar (OEM, keyless) or Teltonika, whichever the pilots use. Odometer and
  fuel are captured automatically at check-out and check-in. Geofence alerts include Oman border
  crossing without a permit.
- **Later backlog:**
  - long-term and subscription rentals (monthly billing, popular in the UAE);
  - rideshare-driver weekly rentals (US);
  - broker/OTA distribution;
  - BNPL (Tabby/Tamara);
  - keyless self-service pickup.
- Load test at 10× the pilot volume. Chaos drill on the worker and the gateway webhook path. Security
  review and pen test before GA.

---

## Test strategy (all phases)

| Layer | What | Where |
| --- | --- | --- |
| Domain unit | rate engine, settlement, eligibility, policy evaluator, state machines | `domain/*.test.ts` (vitest, fast, in CI) |
| Golden cases | real past contracts per market (USD, AED, QAR, OMR) priced to the minor unit | `cars/rates/tests/golden` |
| Contract | every command and event schema and version: consumers' expectations checked against producers | `contract/*.test.ts` |
| DB integration | RLS (tenant A cannot see B, as `rental_app`), exclusion constraints, advisory-lock races, immutability triggers | existing PG17 CI service |
| Concurrency | parallel bookings, double-assign, simultaneous captures | dedicated suite |
| E2E | staff (1440) + phone (390) + **RTL `ar`**, using the existing puppeteer/Playwright scripts pattern | `apps/web/scripts/e2e-cars-*.mjs` |
| Agent evals | golden + adversarial + multilingual, policy-violation rate must be 0 | CI gate for agent prompt/tool changes |
| Performance | widget p95, reservation commit p95, field app offline | k6 or Playwright traces in staging |

## Decisions needed from the owner before or during C0

D1 GCC gateway · D2 ME cell hosting · D3 Qatar/Oman residency · D4 default deposit strategy · D5 KYC
vendor · D6 incremental events migration (recommended) · D7 pilot tenants and their past contracts
for golden cases. Details are in [architecture.md §12](./architecture.md#12-open-decisions-owner).
