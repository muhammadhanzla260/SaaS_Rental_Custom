# Car rental vertical: development plan

Goes with [architecture.md](./architecture.md), [booking-flow.md](./booking-flow.md),
[architecture-review.md](./architecture-review.md) and [security.md](./security.md). Sizes are in
weeks for **2–3 engineers working with coding agents**. They are planning estimates, not
commitments. Each phase follows the repo's release rule: one branch per phase (`cars/phase-cN`), a
Vercel preview on staging, owner QA, then a PR into `main`.

**The task-level plan is in [build/](./build/README.md).** This file is the phase overview.

**Revision 4, 13 Nov 2026.** Owner decisions applied: the Dubai pilot and the shared order header
are confirmed, there is one login for all regions, and legal entities are deferred (one company
per workspace). The week freed in C0 is kept as buffer.

**Revision 3, 12 Nov 2026.** It folds in the architecture review (gaps G1–G18) and the security
architecture. The changes from revision 2:
- The pilot is narrower: **Dubai, self-drive, daily and monthly rentals**, with tolls and fines and
  a staffed WhatsApp inbox.
- The US launch, chauffeur and transfers, insurance replacement, corporate accounts, brokers and
  most agents move to waves after the pilot.
- New work enters before the pilot: stronger sign-in, payment webhooks and
  disputes, fraud checks, live updates, the media pipeline, key management, release safety, the
  SaaS billing layer and the security baseline.

**Ground rules for every phase**
- Events keeps its own flow and keeps working on every merge. The e2e scripts, DB tests and Odoo
  parity (`pnpm --filter @rental/core parity`, 150/150) must stay green.
- New code goes into the module layout (`contract/ domain/ app/ infra/ ui/`). The boundary check
  runs in CI from C0 onward.
- Nothing car-specific is hard-coded if a business could want it different. It goes through the
  settings registry or the rules engine, and gets a preset value.
- Every money path has golden-case tests. Every invariant that can race has a concurrency test.
- Database changes follow expand, backfill, switch, contract. No migration takes a long lock.
- Every new public surface ships with rate limits, input limits and an entry in the threat list.

---

## Timeline at a glance

```
week    1    4    8    12   16   20   24   28   32   36   40
C0   ██████████                                          foundations, identity, security baseline
C1             ████████                                  fleet, catalog, rates, policies, presets
C2                     ██████████                        booking core, risk checks, live updates, search
C3                           ████████                    payments, webhooks, disputes, ledger, tax invoices
C4                                   ████████            drivers, documents, KYC, media, portal, WhatsApp inbox
C5                                           ████████    offline field app: hand-over, return, delivery
C6                                                   ████████   monthly, tolls, fines, maintenance, incidents
C7                                                           ██████  SaaS billing, security hardening, pen test
PILOT                                                              ████████  Dubai operator, real rentals
C10                                                                        ██████ → GA (Dubai self-drive)
C8             ····················································  agents (platform, copilot, extraction, reservation)
C9                     ······························            UAE cell, residency, e-invoicing
```

| Milestone | Week |
| --- | --- |
| UAE cell live | 24 |
| Dubai pilot starts | 32 |
| GA for Dubai self-drive | 39 |
| Post-pilot waves start | 40 |

---

## C0 · Foundations (≈ 5 weeks, weeks 1–5)

**Goal:** add the seams, the configuration kernel and the security baseline without changing event
behaviour.

1. **Kernel** (moved from `@rental/core`; `core` re-exports):
   - `Money` with ISO 4217 exponents and one rounding module;
   - a lint rule against `/100` and `*100` outside the kernel;
   - `COUNTRY_DEFAULTS` for QA and OM; branch calendars;
   - contract helpers `defineCommand`, `defineQuery`, `defineEvent`.
2. **Currency on every money row (G1, entities deferred):**
   - `currency` stored on the order header, invoices, payments and ledger rows, copied from the
     workspace;
   - tax registration, invoice sequences and gateway accounts read through one function, so a
     legal-entity level can be added later in one place.
3. **Configuration kernel:**
   - `defineSetting` registry with six levels (platform, country, workspace, branch,
     class, booking);
   - rules as data with a pure evaluator;
   - policy snapshots;
   - draft and publish for settings and rules (G17).
4. **Approvals inbox**, shared by human rule approvals and agent proposals.
5. **Shared order header:** `vertical`, `stage`, `bill_to_party_id`, `payer_kind`; the
   `VerticalAdapter` registry with events registered first.
6. **Outbox and inbox**, the relay, named queues, and `scheduled_work` so that jobs run once per
   workspace instead of looping over all of them (G10). First strangled coupling: orders →
   messaging.
7. **Identity and access (G2):**
   - one login everywhere: the login tables move to a central identity store that both cells
     trust (built with the UAE cell in C9; until then today's single database is that store);
   - MFA for owners, admins and platform admins; passkeys offered;
   - step-up confirmation for refunds and gateway changes;
   - login tables behind definer functions;
   - roles per vertical and the partner membership kind with its RLS scope.
8. **Keys (G8):** the `v2` secret format with a key id, and re-writing of `v1` values.
9. **Release safety (G9):**
   - a linter, the browser tests and the boundary check in CI;
   - a migration linter and timeouts;
   - migrations applied by the pipeline;
   - a test that every tenant table declares its tenant, location and partner policies.
10. **Security baseline** ([security.md §4](./security.md#4-priority-order), "Now"):
    - CDN and firewall in front of the app and the marketing site, edge rate limits, cached 404s;
    - database statement and idle timeouts, pool limits;
    - a full Content-Security-Policy and HSTS;
    - dependency, secret and static scanning;
    - SPF, DKIM and DMARC at reject.
11. **Observability:** error tracking, tracing, dashboards and alerts.
12. **i18n base:** ICU catalog, `dir` on `<html>`, the kit converted to logical properties.

**Exit:**
- All event e2e scripts, DB tests and parity pass.
- A request loop against an unknown path is cut off at the edge and causes no database calls (load
  test).
- The RLS coverage test and the boundary check are green.
- Existing workspaces work unchanged.
- The kit renders correctly in Arabic.

## C1 · Fleet, catalog, rates, policies, presets (≈ 4 weeks, weeks 6–9)

- **Fleet:**
  - classes (ACRISS, tags, booking level, upgrade ladder), models, vehicles;
  - **ownership** (owned, leased, investor-owned, hired-in) and **cost fields** (G13);
  - documents with expiry alerts; CSV import.
- **Branches:** type, hours, after-hours rules, delivery zones, one-way matrix.
- **Catalog:** extras, protection packages, mileage plans, fuel options.
- **Rate engine** (pure): day/week/month, seasons, weekend days, LOR tiers, km allowance, fees,
  monthly plans, tax through the `TaxEngine` port.
- **Policies** as versioned objects: cancellation, no-show, modification, deposit, late return.
- **Country packs and presets** for the pilot: Dubai standard, Dubai luxury, Monthly UAE.
- **Settings UI** from the registry, the rule test bench, the impact preview, and a **test mode**
  per workspace (G17).
- **Search and paging base (G11):** keyset paging helpers and trigram indexes, used by the fleet
  list first.

**Exit:**
- The golden suite prices 30+ scenarios in AED to the minor unit, plus OMR cases for 3 decimals.
- Reference cases R1–R8 pass as saved bench tests.
- A locked rule cannot be loosened.

## C2 · Booking core (≈ 5 weeks, weeks 10–14)

1. **Spike (weeks 10–11):** a thin car reservation → deposit → invoice → refund → report on the
   shared header.
2. **Availability:** class, model and vehicle strategies; overbooking allowance; upgrade ladder;
   overdue rentals keep their car blocked; hired-in cars add supply for their period.
3. **Reservation aggregate:** parties, pickup and return modes, state machine, gates A/B/C with the
   readiness checklist, policy snapshot, hold expiry and no-show jobs.
4. **Risk checks (G5):** signals collected at Hold and before Confirm; the score is a fact for the
   rules engine.
5. **Commands with dry run**, each returning the explained quote and the checklist. Idempotency
   keys on every write.
6. **Staff counter builder** and **fleet calendar**.
7. **Live updates (G6):** Redis publish/subscribe and a stream endpoint, used by the calendar and
   the approvals inbox.
8. **One search box** for plate, VIN, phone, booking number and name.

**Exit:**
- 50 parallel holds for the last car produce exactly 1 success.
- A vehicle-level double hold is rejected by the database.
- A booking with a high risk score cannot be confirmed without approval.
- A counter booking for a returning customer takes ≤ 90 s.
- A change on one screen shows on another within 2 s.

## C3 · Payments, webhooks, disputes, ledger, tax invoices (≈ 4 weeks, weeks 13–16)

- **`PaymentGateway` port** with capability flags, configured per workspace. Stripe moves behind
  it with no change for events.
- **First GCC gateway** (decision D1).
- **Webhook ingestion (G3):** signature and timestamp checks, an event store, replay, handlers safe
  to run twice. Reconciliation stays as the safety net.
- **Disputes (G3):** dispute records from webhooks and an evidence pack builder.
- **Payment options** for the pilot: pay now, pay at pickup with a card guarantee, cash.
- **Deposit strategies:** hold with re-authorisation, charge and refund with a release window, no
  deposit with a surcharge, none.
- **Ledger** per order; ledger = gateway reconciliation.
- **Immutable tax invoices** with credit and debit notes, bilingual, with TRN.

**Exit:**
- The AED money lifecycle reconciles to the minor unit, including a no-show fee.
- A replayed webhook changes nothing.
- A test dispute produces a complete evidence pack.
- Issued invoices cannot change.

## C4 · Drivers, documents, KYC, media, customer channels (≈ 4 weeks, weeks 17–20)

- **Driver profiles and identity documents**, with field-level encryption using KMS keys per cell
  (G8) and retention purge.
- **Media pipeline (G7):** direct uploads with signed URLs, access by file purpose, view logging,
  thumbnails, malware scanning.
- **Declared vs verified facts;** scan prefill; the KYC vendor (D5); manual verification.
- **Agreement:** versioned, bilingual, e-signed, with consent for post-rental charges.
- **Website booking widget** with Turnstile, signed availability tokens and rate limits.
- **Customer portal** "complete your booking" link.
- **Two-way messaging:** inbound handling, delivery status and opt-out replies.
- **WhatsApp inbox, staffed by people:** templates, in-chat forms, payment links, secure upload
  links. ID photos sent in chat are never stored.
- **Security, "before the pilot" items** that belong here: Redis limits per user and workspace,
  challenge before any one-time code is sent, egress controls.

**Exit:**
- An unverified or ineligible driver cannot pass hand-over.
- A web booking → portal completion → ready works on a phone, in EN and AR.
- Every view of an ID document is in the audit trail.
- Reference case R6 (ID photo in chat) passes.

## C5 · Offline field app: hand-over, return, delivery (≈ 4 weeks, weeks 21–24)

This is new work. The coach portal has no offline support today.

- **App shell:** installable, offline queue, background photo upload, GPS stamp.
- **Check-out** (Gate C → agreement opened): walk-around photos, damage diagram, fuel and
  odometer, customer signature.
- **Evidence integrity (G7):** photo hashes, server time-stamps, chained condition reports.
- **Delivery and collection tasks**, reusing crew dispatch and the live map.
- **Check-in** with side-by-side photos; **settlement** (pure) with deposit capture and release.
- **Extensions, early returns and vehicle swaps.**
- **Yard board** with live updates.

**Exit:**
- Check-out ≤ 2 min for a ready booking on a mid-range phone, with the network switched off.
- The settlement golden suite passes.
- A changed photo or report is detected by the integrity check.
- Deposit release is automatic after a clean return.

## C6 · Monthly, tolls, fines, maintenance, incidents (≈ 4 weeks, weeks 25–28)

- **Monthly rentals:** recurring invoices, auto-charge, km per cycle, swaps, revenue spread across
  the period (G12).
- **Tolls and fines:** Salik and Darb statement import, Dubai and Sharjah fines, matching,
  exceptions queue, admin fee and tax, collection, customer notice with evidence, disputes, deposit
  release within the legal cap.
- **Maintenance:** plans by km or date, work orders, blocks, expiry alerts.
- **Incidents and fleet insurance claims (G13):** incident record with police report, claim,
  repair, time off the road.
- **Investor-owned and hired-in cars (G13):** owner statements and supplier payables.
- **Reports (G12):** the reporting schema, the daily fleet snapshot, utilization, revenue per unit,
  no-show rate, recovery rates, receivables aging.

**Exit:**
- Three monthly cycles reconcile, with excess km and a swap.
- ≥ 95% of toll lines in a real statement auto-match; no line is charged twice.
- An investor-owned car produces a correct owner statement.

## C7 · SaaS billing, security hardening, pilot readiness (≈ 3 weeks, weeks 29–31)

- **Commercial layer (G4):** entitlements, metering, subscriptions per active vehicle, prepaid
  usage balances for WhatsApp, SMS, ID checks and AI.
- **Privacy operations (G16):** export and erase across contexts, legal hold, the vendor register.
- **Security, remaining "before the pilot" items:** step-up everywhere it is required, a tested
  restore, the incident response plan, `security.txt`.
- **First independent penetration test,** with findings fixed.
- **Pilot onboarding:** fleet import, presets tuned, staff trained in test mode.

**Exit:**
- A workspace over its plan limit is stopped in one place, with a clear message.
- A restore from backup meets the recovery targets.
- No open high-severity penetration-test finding.

## Pilot · One Dubai operator (weeks 32–35)

- Real rentals for 4 weeks on the UAE cell.
- Daily review of exceptions: unmatched tolls, at-risk bookings, failed charges, readiness rate.
- Real past bookings from the pilot become the pricing golden cases (D7).

**Exit:** the success metrics in the test strategy are met or have a dated fix.

## C10 · GA hardening (≈ 3 weeks, weeks 36–38) → GA week 39

- Fixes from the pilot.
- Booking websites on the operator's own domain (G14).
- Public API and webhook docs; OAuth apps and scoped keys.
- Accounting exports; importers from other systems.
- Load test at 10× pilot volume; second penetration test; SOC 2 audit period started.
- UAE e-invoicing adapter confirmed against the provider sandbox.

## C8 · Agents (parallel track, weeks 6–31)

1. **Boundaries** ([agent-boundaries.md](./agent-boundaries.md), steps B1–B8): job charters, run
   tokens, violation classes, immediate termination, suspension and reinstatement, output checks,
   canary tools, and the boundary test suite.
2. **Platform:** agent principals, autonomy levels, kill switches, the tool gateway from contracts,
   proposals in the shared inbox, run logs with cost from metering, subject binding, the eval
   harness in CI, the knowledge store, per-cell model routing (D14).
3. **Agents before the pilot:**
   1. Ops copilot (read-only).
   2. Document extraction assistant (a person confirms).
   3. Reservation agent on web chat, then in the WhatsApp inbox, in shadow mode first.
4. **After the pilot:** readiness chaser, fines and tolls matcher, damage assistant, fleet and
   yield advisor, collections.

**Exit:** no forbidden action reaches a command in the boundary suite; every violation ends its
run in the same request; zero policy violations in the adversarial suite; every action traceable; ≥ 95% correct
bookings in eval conversations.

## C9 · UAE cell, residency, e-invoicing (parallel track, weeks 10–24)

- Decision D2, then the `me-central` cell as infrastructure-as-code: load balancer, at least two
  app instances in two zones, database with standby and replica, pooler, Redis, in-region storage,
  KMS, worker, ingest, backups with point-in-time recovery.
- Control plane: workspace → cell directory, the **central identity store** (logins only, with a standby), edge
  routing, sessions trusted by both cells,
  a cross-cell console, staged releases per cell.
- Legal review (D3); the vendor register per cell.
- E-invoicing adapters: UAE PINT AE first; Oman Fawtara with the Oman launch.

**Exit:** a Dubai workspace's data, backups and logs stay in the cell; p95 page response from Dubai
≤ 300 ms; a restore drill passes.

---

## After the pilot: waves (from week 40)

Order to be confirmed with pilot feedback. Sizes are rough.

| Wave | Scope | Size |
| --- | --- | --- |
| P1 · US launch | US country and state packs, airport fees, debit-card rules, US tolls, the US presets, Turo and Getaround calendar sync, a US pilot | ≈ 5 weeks |
| P2 · Chauffeur and transfers | Chauffeur resource, two-resource availability, packages, dispatch, chauffeur app | ≈ 4 weeks |
| P3 · Corporate and insurance replacement | Corporate accounts and portal, insurer accounts, authorisations, split billing, partner portal, SSO | ≈ 5 weeks |
| P4 · Channel hub | Brokers by voucher then XML with one certified broker, OneClickDrive leads, Instagram and Messenger, Google links, Meta conversion events | ≈ 5 weeks |
| P5 · Qatar and Oman | Country packs, local gateway, Oman e-invoicing, cross-border product | ≈ 4 weeks |
| P6 · More agents | Chaser, matcher, damage assistant, yield advisor, collections | ≈ 5 weeks |
| P7 · Later | Telematics and keyless pickup, native app wrappers, platform merchant model, GDS, BNPL | — |

---

## Test strategy (all phases)

| Layer | What |
| --- | --- |
| Domain unit | Rate engine, settlement, rule evaluator, settings resolver, state machines, readiness, risk scoring |
| Property | Rule conflicts resolve deterministically; locked rules can't be loosened; snapshot hashes are stable |
| Golden and reference | Reference cases R1–R16; real past bookings once the pilot starts |
| Contract | Command and event schemas per version; consumers checked against producers |
| Database | RLS as the app role; tenant, location and partner scopes; **every table declares its policies**; exclusion constraints; lock races; header ↔ detail integrity; invoice immutability |
| Concurrency | Parallel holds, double-assign, simultaneous captures, replayed webhooks |
| End to end (in CI) | Counter, web, portal, field app offline; desktop and phone; Arabic RTL; timing checks |
| Security | Rate-limit and flood tests, authorisation tests per role and partner, dependency and secret scans, penetration tests |
| Agent evals | Golden, adversarial, prompt-injection, EN/AR; zero policy violations |
| Performance | Search + quote p95, commit p95, live-update delay, Dubai latency |
| Recovery | Restore drill per cell each quarter |

**Success metrics for the pilot**

| Metric | Target |
| --- | --- |
| Counter booking, returning verified customer | ≤ 90 s |
| Bookings ready before pickup day | ≥ 70% |
| Hand-over for a ready booking | ≤ 2 min |
| Tolls auto-matched | ≥ 95% |
| Deposits released within the legal cap | 100% |
| Agent policy violations | 0 |
| Cross-workspace data exposure | 0 |

## Decisions needed from the owner

| # | Decision | Needed by |
| --- | --- | --- |
| D1 | GCC payment gateway | C3 |
| D2 | UAE cell hosting | C9 (week 10) |
| D3 | Qatar and Oman data residency | P5 |
| D4 | Default deposit strategy | C3 |
| D5 | KYC vendor | C4 |
| D6 | Document and licence lists per country | Pilot |
| D7 | The Dubai pilot operator | C6 |
| D11 | Merchant model (own gateway now; platform later) | C10 |
| D12 | SaaS pricing (per active vehicle + prepaid usage) | C7 |
| D13 | Native apps | After the pilot |
| D14 | AI model region for Gulf data | C8 (before agents handle personal data) |
| D15 | Government contract registration rules | C6 |
| D16 | Recovery targets | C0 |
