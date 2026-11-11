# Architecture review: the current app and the car rental plan

Written 11 Nov 2026 after a second, deeper read of the code on `main` and a review of the
consolidated plan ("Rent Hatch Car Rental: A–Z Architecture & Plan", 10 Nov 2026).

This review has four parts:
1. what the current application is;
2. facts the plan got wrong;
3. major gaps in the architecture of the whole product, ranked;
4. smaller enhancements.

Items marked **(verify)** come from general industry knowledge, not from research in this review.

---

## 1. The current application

### 1.1 Goal
A multi-tenant SaaS for party and event rental businesses, rebuilt from the FreedomFun USA Odoo 19
system. Freedom Fun is tenant 1. The app is live as Rent Hatch (`app.renthatch.org`), with a
marketing site (`renthatch.org`) that already advertises a car rental product in early access.

### 1.2 What is built (Phases 0 to 4b)

| Area | Built |
| --- | --- |
| Workspaces | Sign-up, 6-step onboarding, branding and theme engine, locations (location = warehouse), team, invitations, roles and extra grants, activity log |
| Platform console | Workspace list, plans as labels, suspend, close with 30-day purge, read-only support sessions (audited) |
| Catalog and stock | Categories, products with staffed / pickup / drop-off prices, per-location prices, pooled and serialized stock, overbooking switch per pool |
| Customers | Search, duplicate warning, addresses, credits (rain check, wallet, goodwill), CSV import |
| Orders | Order builder with live server-checked totals, Odoo-parity pricing, price locks, versions with diffs, coupons, travel fee from driving distance, cancel outcomes, reschedule, duplicate |
| Availability | Reservations held in SQL under an advisory lock, with a cleanup buffer |
| Customer quote page | Public link by token: review, sign (text, version, IP stored), pay deposit or in full, calendar file, print pages |
| Money | Invoices derived from the order, manual payments, Stripe card payments, saved card, event-day auto-charge, refunds, tips, overpayment handling, Stripe reconciliation |
| Messaging | Templates, tenant SMTP and SMS accounts, scheduled automations in each location's time zone, exactly-once sending, message log, office alerts, daily digest |
| Ops | Ops board with rules and snoozes, calendar (month, week, day), inventory view |
| Field | Coach portal: assigned orders, phased checklists, photos, GPS pings while en route; crew board with live map; maintenance tickets |
| Reports | 600+ lines of SQL reports, CSV export, print view, weekly email schedule |

### 1.3 How it is built

| Layer | Detail |
| --- | --- |
| Web | Next.js 16 App Router on Vercel, region `pdx1`. Server components, server actions, no client data cache. Tenant is a path segment (`/[tenant]/…`); there is no middleware |
| Data | PostgreSQL 17 on Supabase (Oregon). Drizzle. 43 migrations. Every tenant table has `tenant_id`, composite keys and row-level security. The app connects as a non-owner role |
| Domain | `@rental/core`: pure TypeScript (pricing, settings schemas, permissions, time, regional). `@rental/db`: schema plus every service. `@rental/messaging`, `@rental/payments` |
| Jobs | graphile-worker on Railway, six cron tasks, concurrency 3 |
| Files | Cloudflare R2 (or the database in development) |
| Tests | 23 test files, 235 cases, including RLS tests as the restricted role. Browser e2e scripts are run by hand |
| CI | Migrate, typecheck, unit and DB tests, build. Nightly `pg_dump` to R2 |

### 1.4 Strengths worth protecting
- Tenant isolation is real: RLS as a non-owner role, composite foreign keys, definer functions for
  the few cross-tenant reads, 404 instead of 403, Supabase API roles revoked.
- Money correctness is taken seriously: 150/150 Odoo parity, price locks, idempotency keys on every
  Stripe call, a refunds row written before the gateway call.
- Messages cannot be sent twice.
- The code is small and readable for what it does (about 11k lines in services and schema).

### 1.5 Weaknesses found in this read

| # | Finding | Evidence |
| --- | --- | --- |
| W1 | One workspace has one currency and one tax identity | `tenants.currency`, `tenants.tax_id`; orders have no currency column; version history prints `$` and `toFixed(2)` |
| W2 | Card payments have no webhooks | No webhook route exists. Payments are confirmed by the browser returning, then by a job that searches Stripe every 15 minutes per workspace |
| W3 | Each workspace pastes its own Stripe secret key | `payment_accounts.secret_enc`; no Stripe Connect, no platform fee |
| W4 | No MFA, passkeys or SSO | Better Auth with email + password and magic link only |
| W5 | Login tables are readable by the app role | `users`, `sessions`, `accounts`, `verifications` have no RLS; only the admin flag is protected |
| W6 | One encryption key for all secrets, with no key id | `crypto.ts` format `v1.<iv>.<tag>.<data>`; rotation is not possible without re-encrypting everything |
| W7 | Files go through the app server | Uploads through server actions (4 MB cap); downloads read the whole object into memory; any member of a workspace can read any private file |
| W8 | Location limits cover only four tables | `location_scope` policies on `orders`, `messages`, `invoices`, `payments`; not on lines, reservations, refunds, signatures |
| W9 | Lists do not scale | `limit 200` with no paging; search is `ILIKE '%…%'` with no trigram index |
| W10 | Screens refresh by polling | `LiveRefresh` reloads list pages every 60 seconds |
| W11 | Jobs loop over every workspace | Digest, weekly reports and Stripe reconciliation scan all tenants in one task |
| W12 | No error tracking, tracing or metrics | 19 `console.*` calls; no observability dependency |
| W13 | Migrations are applied by a hand-run script | `scripts/deploy-db.ts`; no migration linting, no lock timeouts |
| W14 | CI has no linter and no browser tests | The e2e scripts are not in the workflow |
| W15 | Plans are labels | `tenants.plan` is never checked; there is no billing for the SaaS itself |
| W16 | The coach portal is not an offline app | No service worker, manifest or IndexedDB anywhere in `apps/web` |
| W17 | Messaging is one-way | No inbound email, SMS or delivery-status handling |

---

## 2. Facts the plan got wrong

| # | The plan says | Reality | Fix |
| --- | --- | --- | --- |
| C1 | The current stack is the "us-east" cell | The database is in Supabase Oregon and the app runs in Vercel `pdx1`. The README still says East US, which is stale | Name the cell `us-west`; correct the README |
| C2 | The coach portal is a PWA to "generalise" | It is a normal web page with no offline support (W16) | Treat the offline field app as new work in C5, not reuse |
| C3 | "Stripe reconcile job" listed as a strength to extend | It is polling that stands in for webhooks (W2). It will not carry holds, 3-D Secure, disputes or thousands of workspaces | Build webhook ingestion in C3 and keep reconciliation as the safety net |
| C4 | The existing architecture doc mentions Neon in places | Production is Supabase | Clean up `docs/architecture.md` |

---

## 3. Major gaps, ranked

### Tier 1: decide before C0 starts (they change the data model)

**G1. Legal entities and several currencies inside one workspace.**
- The plan gives a branch a tax jurisdiction, but a workspace still has one currency and one tax
  number (W1).
- A business with branches in Dubai and Muscat is two companies, with two tax registrations, two
  currencies, two gateway accounts and two sets of invoice numbers.
- Add a `legal_entity` level between workspace and branch. It owns the currency, tax registration,
  invoice sequences, gateway accounts, e-invoicing credentials and bank details. Each order header
  carries its entity and currency. Reports state their currency and never add across currencies
  without a rate.
- This also belongs in the settings levels (platform → country → workspace → **entity** → branch).

**G2. Where logins live once there are two regions.**
- The plan keeps one shared `users` table and also says "sessions are per cell". Those two cannot
  both be true for a person who works in a US workspace and a UAE workspace.
- Pick one now:
  - **Global identity** in the control plane: one login everywhere, but the control plane then
    holds emails and credentials, which the plan says it must not.
  - **Per-cell identity**: a separate login per region, joined later by single sign-on.
- Recommendation: per-cell identity now, since very few people will need both regions. Keep the
  email unique per cell and design the workspace directory to hold no personal data.
- In the same phase, harden access, because the product will hold ID documents and move money:
  - MFA for any role that can refund, see ID documents or change gateway keys;
  - step-up confirmation for those actions;
  - SSO (SAML/OIDC) for larger operators, insurers and corporate partners;
  - API keys and OAuth with scopes for the public API and MCP server;
  - close W5 by moving session and login lookups behind definer functions.

**G3. The payments operating model.**
- Today each workspace brings its own Stripe key (W3) and there are no webhooks (W2).
- The plan adds a gateway interface but never decides who the merchant is. Two models:
  - **Bring your own gateway** (today): simple, no money flows through Rent Hatch, no platform fee.
  - **Platform model** (Stripe Connect or a payment-facilitator partner): Rent Hatch can take a fee
    per transaction and onboard businesses faster, at the cost of compliance duties.
- The gateway interface should support both, and the decision drives pricing (G4).
- Required either way, and missing from the plan:
  - signed webhook ingestion with an event store and replay;
  - **card disputes (chargebacks)**: a workflow that assembles the signed agreement, photos, ID
    check and toll or fine evidence. Car rental has high dispute rates **(verify)**;
  - hold expiry tracking and payout reconciliation.

**G4. The commercial layer of the SaaS itself.**
- Plans are labels (W15). The earlier roadmap's Phase 6 (self-serve billing, Connect, custom
  domains, API) is not built and the car plan does not schedule it.
- Car rental software is usually priced per vehicle or per branch, and this product adds real
  pass-through costs: WhatsApp conversations, SMS, ID checks, AI usage, e-invoicing.
- Add a platform context with:
  - **entitlements**: features and limits by plan, checked in one place;
  - **metering**: usage events for vehicles, bookings, messages, ID checks and agent runs;
  - **billing**: subscriptions, invoices in the right currency and tax, trials, failed-payment
    handling;
  - **prepaid usage balances** for pass-through costs, so a busy workspace cannot run up unbounded
    cost.
- Agent budgets in the plan depend on this metering.

**G5. Fraud and risk.**
- The plan has eligibility rules and ID checks but no risk capability.
- Car rental's large losses are stolen-card bookings, identity fraud and cars that are not
  returned. Luxury fleets and chat-based booking raise the exposure.
- Add a risk step to the booking gates, fed by signals: card country against licence country,
  booking velocity, device, mismatched names, blacklist hits, selfie liveness from the ID vendor,
  and 3-D Secure results.
- Outcomes use the rules engine that already exists (deny, approval, higher deposit, require 3-D
  Secure).
- For vehicles on rent, add overdue escalation and a recovery workflow (telematics location,
  police report).

### Tier 2: design before the phase that needs them

**G6. Live updates.**
- Polling every 60 seconds (W10) is fine for events. It is not enough for a fleet calendar, a yard
  board, chauffeur dispatch or a shared chat inbox with several staff and an agent.
- Add a push channel (server-sent events or WebSockets, fed by outbox events) with access checked
  per workspace, branch and partner. Needed by C2.

**G7. Photos, documents and evidence.**
- A 500-car fleet will upload well over a thousand photos a day. Today's upload path cannot carry
  that (W7).
- Add:
  - direct-to-bucket uploads with short-lived signed URLs, and a bucket per cell;
  - access by file purpose, so ID documents need a permission and every view is logged;
  - thumbnails, malware scanning of customer uploads, and lifecycle rules;
  - **evidence integrity**: hash each photo at capture, take the timestamp from the server, and
    chain condition reports so they cannot be altered later. This is what makes a damage or fine
    charge defensible.

**G8. Key management.**
- The plan asks for per-workspace keys and a KMS, but today's format has no key id (W6).
- Introduce a `v2` format with a key id, envelope encryption with a KMS key per cell, a separate key
  for searchable hashes, and a rotation job. Do this before the first licence number is stored (C4).

**G9. Release engineering and operations.**
- Turning the live `orders` table into a shared header is the riskiest change in the plan, and
  migrations are run by hand (W13).
- Add:
  - expand-then-contract migration rules, lock timeouts, batched backfills, and a migration linter;
  - migrations applied by the pipeline, per cell, with a staged rollout (staging → one cell →
    all);
  - a linter and browser tests in CI (W14), plus a check that every tenant table declares its
    tenant, location and partner policies (closes W8 for good);
  - error tracking, tracing, alerting and on-call (W12), with personal data scrubbed from logs;
  - recovery targets, point-in-time recovery, and a restore drill for each cell. Backups exist;
    restores are untested.

**G10. Background work at scale.**
- Replace the "loop over every workspace" tasks (W11) with one small job per workspace, scheduled
  from a `next_run_at` table. The plan's named queues do not fix this on their own.

**G11. Search and paging.**
- Add keyset paging everywhere and indexed search (W9) before fleet, reservation and customer lists
  are built. Staff need one search box for plate, VIN, phone, booking number and name. Agents need
  the same queries as tools.

**G12. Reporting and accounting.**
- Reports run on the live database. Fleet measures such as utilization need a daily snapshot table,
  not recalculation.
- Add a reporting schema fed by outbox events, served from the read replica.
- For accountants: revenue spread over the rental period for monthly rentals, deposits as a
  liability, receivables aging by payer, and a general-ledger export per legal entity (G1).

**G13. Car rental domain gaps.**
- **Accidents and insurance claims** on the fleet's own policy: incident report, police report
  (commonly required before repair in the UAE **(verify)**), claim, repair, time off the road.
- **Cars the operator does not own**: investor-owned cars with an owner's revenue share, and cars
  hired from another operator to fill a booking. Both are common in Dubai **(verify with pilots)**.
  They change availability (outside supply) and money (payables to owners and suppliers).
- **Vehicle cost and lifecycle**: purchase or lease cost, depreciation, disposal. Without it the
  product cannot show profit per vehicle.
- **Government contract registration**: some Gulf states require rental contracts to be registered
  in a government system (Saudi Arabia's Tajeer is one **(verify)**). Check what the UAE, Qatar and
  Oman require, because transferring a fine to the driver may depend on it.

**G14. The customer-facing side.**
- Operators need a branded booking website on their own domain, with pages that rank in search.
  The app has path-based workspaces and no middleware.
- Design tenant-domain routing, edge caching for availability pages, and custom domain setup.
- Decide whether repeat customers get an account (per workspace) or stay on one-time links.
- Decide on native apps. An installable web app has limits on iPhones (background upload, push
  notifications, storage eviction) that matter for the field and chauffeur apps.

**G15. Agents.**
- **Where the model runs.** The plan promises in-region AI for Gulf data. Confirm that the chosen
  models are available in a UAE region. If not, decide which agent features may send personal data
  outside the region, per workspace.
- **A knowledge store** per workspace for policy answers, with the same row-level security.
- **Durable runs**: conversations and multi-day processes (chasing documents, fine disputes) need
  state that survives restarts. Decide between graphile-worker with persisted state and a
  durable-workflow engine.
- **Cost per workspace** from metering (G4), and fraud checks (G5) before an agent confirms a
  booking.

**G16. Privacy operations.**
- Export and deletion of one person's data must work across every context. Give each context an
  `exportSubject` and `eraseSubject` contract, and add legal hold.
- List every outside service that touches personal data in each cell: logs, error tracking,
  backups, email, SMS, WhatsApp, ID vendor, AI. Today's backup bucket and mail routes are US-based.

### Tier 3: reduce risk in what is already planned

**G17. Keep the configuration system manageable.**
- Nine setting levels plus a rules engine is powerful and easy to get lost in.
- Ship fewer levels first (platform, country, workspace, entity, branch, class, booking). Add
  channel, rate plan and corporate account when a customer needs them.
- Add draft and publish for settings and rules, with a preview of impact ("this change would have
  affected 37 bookings last month").
- Add a test mode per workspace: test bookings and a test gateway, so staff can try rules safely.
- Add export and import of configuration between workspaces.

**G18. Scope against team size.**
- The plan fits about 38 weeks of work into a team of 2 to 3 engineers and includes two regions,
  four service modes, a channel hub and eight agents. This review adds more.
- Recommendation: narrow the pilot to one market and one mode. A Dubai pilot with self-drive daily
  and monthly rentals, tolls and fines, and a staffed WhatsApp inbox covers the hardest
  differentiators. Move chauffeur, insurance replacement, broker XML and most agents to after the
  pilot.

---

## 4. Smaller enhancements

- **Public endpoints**: rate limits and bot protection on the booking widget, the quote page, chat
  and the broker endpoint. The marketing site has this; the app does not.
- **Public API**: a version policy, idempotency keys on every write, and a webhook delivery log
  with replay.
- **Customers**: a merge tool for duplicate customers, since the customer record becomes shared
  across two verticals.
- **Two-way messaging** (W17): inbound handling, delivery status, and opt-out replies must exist
  before the shared inbox.
- **A workspace that runs both verticals**: one calendar, one customer view, and navigation that
  switches vertical.
- **Events roadmap**: Phases 5 and 6 of the events plan (Odoo migration, billing, custom domains,
  API) share work with G4 and G14. Plan them once for both verticals.

---

## 5. What I would change in the plan first

1. Add G1 (legal entities), G2 (identity and access) and the G8 key format to **C0**.
2. Add webhooks, disputes and the merchant-model decision (G3) to **C3**.
3. Add a new phase before the pilot for the commercial layer (G4), or decide that the pilot runs on
   manual billing.
4. Add fraud checks (G5) and live updates (G6) to **C2**, and the media pipeline (G7) to **C4**.
5. Narrow the pilot scope (G18) so the above fits.
