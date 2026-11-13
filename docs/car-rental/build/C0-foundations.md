# C0 · Foundations and security baseline (weeks 1–5)

Branch: `cars/phase-c0`. Goal: add the seams, the configuration kernel and the security baseline
**without changing how event rentals behave**.

Suggested order: C0-01 → 02 → 03 → 05 → 06 → 07 → 08, then the rest in dependency order. Tasks
without a shared dependency can run in parallel sessions.

**Phase exit**
- `pnpm typecheck`, `pnpm test` and the event browser scripts pass.
- The boundary check and the table-policy test run in CI and pass.
- A loop of requests at an unknown path causes no database queries (C0-21) and is cut off at the
  edge (C0-22).
- Existing workspaces behave exactly as before.
- The kit renders correctly right-to-left (C0-24).

---

## A. Tooling and safety nets

### [ ] C0-01 · Add a linter and run it in CI
- Size: S
- Goal: catch mistakes and enforce later rules (money maths, boundaries).
- Change:
  - Add ESLint (flat config, `typescript-eslint`) at the repo root with a `lint` script in each
    package and a `lint` task in `turbo.json`. Read the installed Turborepo docs first, as
    `AGENTS.md` requires.
  - Start with recommended rules only. Fix or narrowly disable existing violations; do not
    reformat files.
  - Add a "Lint" step to `.github/workflows/ci.yml` before "Typecheck".
- Done when: `pnpm lint` passes locally and in CI; no behaviour change.
- Verify: `pnpm lint && pnpm typecheck && pnpm test`

### [ ] C0-02 · Create `@rental/kernel` with `Money`
- Size: M
- Depends on: C0-01
- Goal: one money type that works for 2- and 3-decimal currencies.
- Change:
  - New package `packages/kernel` (`package.json`, `tsconfig.json`, vitest), added to
    `transpilePackages` in `apps/web/next.config.ts`.
  - `src/money/`: `Currency` codes with ISO 4217 exponents (USD, AED, QAR, SAR = 2; OMR, KWD,
    BHD = 3); `Money = { minor: bigint | number; currency }` (pick one representation and document
    why); `add`, `subtract`, `multiply` by a rate with an explicit rounding mode, `allocate`,
    `fromDecimalString`, `format(money, locale)`.
  - ESLint rule (`no-restricted-syntax`) that flags `/ 100`, `* 100` and `.toFixed(2)` in
    `packages/platform`, `packages/cars` and `packages/kernel` outside `src/money/`.
- Done when: unit tests cover OMR `10.500`, rounding half-up and half-even, allocation that sums
  exactly, and formatting in `en-AE` and `ar-AE`.
- Verify: `pnpm --filter @rental/kernel test`

### [ ] C0-03 · Kernel: `Result` and contract helpers
- Size: M
- Depends on: C0-02
- Goal: one way to declare commands, queries and events.
- Change: in `packages/kernel/src/contract/`:
  - `Result<T, E>` with typed error codes;
  - `defineCommand(name, version, { input, output, permission, risk, supportsDryRun })`,
    `defineQuery(...)`, `defineEvent(name, version, payload)`, all zod-based;
  - `risk` is one of `read`, `reversible_write`, `irreversible`, `money_movement`,
    `customer_comms`, `pii_access`;
  - a registry that lists every definition (used later for the API, agent tools and docs).
- Done when: tests show input validation errors map to field errors, and a definition can be
  listed from the registry with its metadata.
- Verify: `pnpm --filter @rental/kernel test`

### [ ] C0-04 · Regional data for Qatar and Oman, and branch calendars
- Size: S
- Goal: the regional layer knows the pilot's neighbours and weekend days.
- Change:
  - `packages/core/src/regional.ts`: add `QA` (QAR, `Asia/Qatar`, km) and `OM` (OMR,
    `Asia/Muscat`, km) to `COUNTRY_DEFAULTS` and the currency list.
  - `packages/kernel/src/time/calendar.ts`: `weekendDays(country)` (UAE Sat–Sun; Qatar and Oman
    Fri–Sat; US Sat–Sun) and a `Season` type with date ranges.
- Done when: tests cover the four countries; existing regional tests still pass.
- Verify: `pnpm --filter @rental/core test && pnpm --filter @rental/kernel test`

### [ ] C0-05 · Boundary check in CI
- Size: M
- Depends on: C0-02
- Goal: imports that cross a boundary fail the build.
- Change:
  - Add `dependency-cruiser` with rules:
    - `packages/kernel` and `packages/core` import no database, network or Next.js code;
    - `packages/cars/**` does not import `packages/core`, `packages/db/src/services/**` or event
      code;
    - inside `packages/platform` and `packages/cars`, a context imports another context only
      through its `contract/`;
    - `**/domain/**` imports nothing from `**/infra/**` or `**/app/**`.
  - Script `pnpm boundaries`, and a CI step.
- Done when: the check passes on the current tree, and a deliberate bad import in a scratch file
  makes it fail (then remove the file).
- Verify: `pnpm boundaries`

### [ ] C0-06 · CI: browser tests, migration linter, security scans
- Size: L
- Depends on: C0-01
- Goal: CI catches what is checked by hand today.
- Change in `.github/workflows/ci.yml` (separate jobs so the main job stays fast):
  - **e2e**: build and start the web app against the CI database, then run
    `apps/web/scripts/e2e-phase0.mjs` and `e2e-orders.mjs`. Fix flakiness rather than retrying.
  - **migrations**: lint new SQL in `packages/db/migrations` (for example with `squawk`), failing
    on table rewrites and on index creation without `CONCURRENTLY` on existing tables.
  - **security**: dependency audit (`pnpm audit --prod`, failing on high), secret scanning, and
    static analysis (CodeQL) on pull requests.
  - Pin third-party actions to commit SHAs.
- Done when: all jobs run on a pull request and pass on the current tree.
- Verify: push the branch and check the workflow run.

### [ ] C0-07 · Database timeouts and pool limits
- Size: S
- Goal: a slow or stuck query cannot hold connections.
- Change:
  - Migration: `ALTER ROLE rental_app SET statement_timeout = '15s'`,
    `idle_in_transaction_session_timeout = '30s'`, `lock_timeout = '5s'`.
  - `packages/db/src/client.ts`: accept `connect_timeout` and `max_lifetime`; document the pool
    size per environment in a comment.
  - Give long reports their own higher limit with `SET LOCAL statement_timeout` inside the report
    transaction only.
- Done when: a test that runs `pg_sleep(20)` as `rental_app` fails with a timeout; reports and the
  full test suite still pass.
- Verify: `pnpm db:migrate && pnpm --filter @rental/db test`

### [ ] C0-08 · Test that every tenant table declares its policies
- Size: M
- Goal: a new table can never ship without isolation.
- Change: new test `packages/db/src/rls-coverage.test.ts` that reads `pg_catalog` and asserts:
  - every table with a `tenant_id` column has row-level security enabled and a `tenant_isolation`
    policy;
  - every table listed in a `LOCATION_SCOPED_TABLES` constant has a `location_scope` policy;
  - no table grants `rental_app` more than it needs on the platform tables.
- Also add the missing `location_scope` policies found by the review for tables that hang off
  orders (`order_lines`, `reservations`, `refunds`, `signatures`, `order_versions`,
  `credit_applications`), following `0040_location_scope.sql`.
- Done when: the test passes, and removing a policy in a scratch migration makes it fail.
- Verify: `pnpm --filter @rental/db test`

---

## B. Identity, keys and headers

### [ ] C0-09 · Lock down the login tables
- Size: L
- Goal: the app role can no longer read sessions, credentials or every user.
- Change:
  - First list every read of `users`, `sessions`, `accounts`, `verifications` outside
    `apps/web/src/server/auth.ts` (`grep -rn "schema.users\|users\b" packages/db/src`).
  - New database role `rental_auth` with access to the four login tables only. `auth.ts` uses a
    second connection (`AUTH_DATABASE_URL`) for the Better Auth adapter.
  - `rental_app` keeps `SELECT (id, name, email, image)` on `users` (needed for names in lists)
    and loses everything on `sessions`, `accounts` and `verifications`. Lookups that need more go
    through `SECURITY DEFINER` functions with narrow signatures.
  - Update `packages/db/scripts/migrate.ts`, `deploy-db.ts`, `.env.example` and the README for
    the new role and variable.
- Done when: a test as `rental_app` gets "permission denied" on `sessions`; sign-up, sign-in,
  magic link, invitations and support sessions still work (`e2e-phase0.mjs`).
- Verify: `pnpm db:migrate && pnpm test && node apps/web/scripts/e2e-phase0.mjs`

### [ ] C0-10 · MFA, passkeys and step-up confirmation
- Size: L
- Depends on: C0-09
- Goal: strong sign-in for roles that can move money or change settings.
- Change:
  - Enable Better Auth's two-factor (TOTP + recovery codes) and passkey plugins; add their
    tables by migration.
  - Account settings page: enrol, list and remove factors.
  - Policy: owners, admins and platform admins must enrol at next sign-in. Platform admins need
    a passkey.
  - `requireRecentAuth(maxAgeMinutes)` in `apps/web/src/server/context.ts`. Use it in the server
    actions for refunds, payment-gateway settings, mail settings and member management.
- Done when: tests cover enrol, sign-in with a second factor, recovery code use, and a refund
  action refused without a recent confirmation.
- Verify: `pnpm test` and a manual pass of the sign-in screens at 1440 and 390 px.

### [ ] C0-11 · Secret format v2 with key ids
- Size: M
- Goal: encryption keys can be rotated.
- Change in `packages/db/src/crypto.ts`:
  - New format `v2.<keyId>.<iv>.<tag>.<data>`. Keys come from `APP_ENCRYPTION_KEYS` (a JSON map
    of id → key) with `APP_ENCRYPTION_KEY_CURRENT`; the old `APP_ENCRYPTION_KEY` is read as key
    id `legacy`.
  - `decryptSecret` reads `v1` and `v2`. `encryptSecret` always writes `v2`.
  - Script `packages/db/scripts/reencrypt-secrets.ts` that rewrites every `*_enc` column to the
    current key, in batches, and is safe to run twice.
  - A separate `hashForSearch(value)` using an HMAC key, for later use on ID numbers.
- Done when: tests cover reading `v1`, writing `v2`, rotating to a new key id, and a wrong key
  failing closed.
- Verify: `pnpm --filter @rental/db test`

### [ ] C0-12 · Full security headers
- Size: M
- Goal: a real Content-Security-Policy and HSTS.
- Change in `apps/web`:
  - Per-request nonce and a CSP that allows only self, the nonce, Stripe (`js.stripe.com`,
    its frames and API) and Mapbox. Keep `frame-ancestors 'none'`.
  - `Strict-Transport-Security` (2 years, include subdomains), `Cross-Origin-Opener-Policy`,
    `Cross-Origin-Resource-Policy`.
  - Start in report-only mode for one release, log violations, then enforce.
- Done when: the quote page can still pay with the Stripe test card and maps still load, with no
  CSP violations in the browser console on the pages covered by the e2e scripts.
- Verify: `pnpm --filter @rental/web build`, start, run `e2e-orders.mjs` and
  `e2e-payment-options.mjs`.

---

## C. Events, jobs and the shared header

### [ ] C0-13 · `@rental/platform` with the outbox
- Size: L
- Depends on: C0-03, C0-05
- Goal: contexts can announce changes without importing each other.
- Change:
  - New package `packages/platform` with `src/outbox/`.
  - Tables `platform.outbox` (`id`, `tenant_id`, `type`, `version`, `payload`, `occurred_at`,
    `published_at`) and `platform.inbox` (`consumer`, `event_id`), with RLS.
  - `publish(tx, event)`: writes the outbox row and runs **in-transaction subscribers**
    registered for that event type. These run in the same transaction, so today's "book the order
    and plan its messages atomically" behaviour is kept.
  - A relay task in `apps/worker` that delivers unpublished rows to **async subscribers**, with
    de-duplication through `inbox`. Use `LISTEN/NOTIFY` plus a poll.
  - Split worker work into named queues: `critical`, `messaging`, `projections`, `reports`, `ai`.
- Done when: tests show an event and its in-transaction subscriber commit or roll back together;
  an async subscriber runs exactly once when the relay is run twice; RLS blocks another tenant.
- Verify: `pnpm --filter @rental/platform test && pnpm --filter @rental/worker typecheck`

### [ ] C0-14 · Orders announce; messaging listens
- Size: L
- Depends on: C0-13
- Goal: remove the direct calls from orders into messaging, with identical behaviour.
- Change:
  - Define `events.OrderQuoteSent`, `events.OrderBooked`, `events.OrderCancelled`,
    `events.PaymentRecorded` with `defineEvent`.
  - In `packages/db/src/services/orders.ts` and `money.ts`, replace calls to
    `enqueueOrderMessage`, `planOrderMessages`, `enqueuePaymentConfirmation` and
    `enqueueOfficeAlert` with `publish(tx, …)`.
  - Register in-transaction subscribers in the messaging service that do exactly what the removed
    calls did. Message idempotency keys must not change.
- Done when: `orders.ts` no longer imports from `./messaging`; `orders.test.ts`,
  `money.test.ts`, `cancel.test.ts` and `packages/messaging` tests pass unchanged; the e2e
  scripts for phases 2a and 2b pass.
- Verify: `pnpm test` and `node apps/web/scripts/e2e-phase2a.mjs`

### [ ] C0-15 · One job per workspace
- Size: M
- Depends on: C0-13
- Goal: one slow workspace no longer delays the others.
- Change:
  - Table `platform.scheduled_work(tenant_id, task, next_run_at, last_run_at, last_error)`.
  - A dispatcher task that enqueues one graphile job per due row, with a job key of
    `task:tenant`.
  - Convert `daily_digest`, `weekly_reports` and `reconcile_payments` in
    `apps/worker/src/index.ts` from loops into per-workspace jobs. Rows are created when a
    workspace is created or enables the feature, and by a backfill.
- Done when: a test with two workspaces shows that an error in one does not stop the other, and a
  job is not enqueued twice for the same slot.
- Verify: `pnpm test && pnpm --filter @rental/worker once`

### [ ] C0-16 · Order header columns
- Size: L
- Depends on: C0-02
- Goal: `orders` can act as the shared header.
- Change (additive only; no event column is moved in this phase):
  - Add to `orders`: `vertical text not null default 'events'` with a CHECK, `stage text`,
    `currency text`, `bill_to_customer_id uuid`, `payer_kind text default 'customer'`, and
    `UNIQUE (tenant_id, id, vertical)`.
  - Backfill in batches: `currency` from the tenant, `bill_to_customer_id` from `customer_id`,
    `stage` from `status` (draft → draft; quote_sent → open; booked → confirmed; completed →
    completed; cancelled → cancelled). Then set `stage` and `currency` to `NOT NULL`.
  - Keep `stage` in step with `status` inside `transitionOrder`, `createOrder` and `cancelOrder`.
  - Add `currency` to `invoices`, `payments`, `refunds` and `credits`, backfilled from the tenant.
  - Replace the hard-coded `$` and `toFixed(2)` in the order version snapshot with the kernel's
    `format`.
- Done when: a database test shows every order has a stage that matches its status after each
  transition; totals and event pricing tests are unchanged.
- Verify: `pnpm db:migrate && pnpm test`

### [ ] C0-17 · `VerticalAdapter` registry
- Size: M
- Depends on: C0-13, C0-16
- Goal: shared code asks the vertical instead of branching on it.
- Change:
  - `packages/platform/src/verticals/`: the `VerticalAdapter` interface (`documentLines`,
    `messageFields`, `summary`, `onPaymentSettled`, `cancellationPolicy`, `pageUrl`) and a
    registry keyed by vertical.
  - Register an events adapter that wraps today's functions. Route the invoice print page and the
    order link through it.
  - ESLint rule: no comparison with `'cars'` or `'events'` literals inside `packages/platform`.
- Done when: the invoice print page and order links work as before; the lint rule fails on a
  scratch `vertical === 'cars'` in platform code.
- Verify: `pnpm lint && pnpm test`

---

## D. Configuration kernel

### [ ] C0-18 · Settings registry and resolver
- Size: L
- Depends on: C0-03, C0-13
- Goal: settings resolve through levels and explain where a value came from.
- Change in `packages/platform/src/settings/`:
  - `defineSetting(key, { schema, default, scopes, editableBy, lockOnConfirm, bounds, label })`.
  - Table `platform.settings_values(tenant_id, scope_type, scope_id, key, value, version, status
    ('draft' | 'published'), effective_from, set_by)`.
  - `resolve(key, context)` over six levels: platform → country → workspace → branch → class →
    booking. It returns `{ value, source: { level, id, setBy, at } }`.
  - Country bounds: a value outside a locked bound is rejected with the reason.
  - Cache by `(tenant, config_version)`; a publish bumps the version.
  - Existing `tenantPreferencesSchema` settings keep working unchanged. Do not migrate them here.
- Done when: tests cover most-specific-wins, effective dates, bounds, drafts not being visible to
  `resolve`, provenance, and tenant isolation.
- Verify: `pnpm --filter @rental/platform test`

### [ ] C0-19 · Rules engine
- Size: L
- Depends on: C0-03
- Goal: requirements and fees are data, evaluated by one pure function.
- Change:
  - `packages/kernel/src/rules/`: the fact model types, the condition language (`all`, `any`,
    `not`, and operators `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `not_in`, `exists`), the
    effects (`deny`, `require_approval`, `require_document`, `require_field`, `add_fee`, `set`,
    `restrict`, `warn`, `suggest`), and `evaluate(rules, facts)` returning effects plus a trace
    of which rule fired and why.
  - Conflict resolution as in `booking-flow.md` §4.2. Locked rules cannot be removed or loosened.
  - `packages/platform/src/rules/`: table `platform.rules` (scope, `when`, `then`, `locked`,
    `priority`, version, status, `effective_from`) and `platform.rule_tests` for saved cases.
- Done when: unit tests cover every operator and effect; property tests show the result does not
  depend on rule order; a tenant rule cannot loosen a locked rule.
- Verify: `pnpm --filter @rental/kernel test && pnpm --filter @rental/platform test`

### [ ] C0-20 · Policy snapshots and the approvals inbox
- Size: M
- Depends on: C0-18, C0-19
- Goal: confirmed terms can be frozen, and anything needing a decision lands in one queue.
- Change:
  - `platform.policy_snapshots(id = content hash, resolved, rule_set_version)` with
    `snapshot(context)` that stores the resolved value of every `lockOnConfirm` setting.
  - `platform.approvals(tenant_id, id, subject_type, subject_id, requested_by_type ('user' |
    'agent'), requested_by, rule_id, reason, payload, status, decided_by, decided_at)`.
  - Commands `approvals.request` and `approvals.decide` (permission-bound, audited), and a query
    for the open queue. The screen is built in C2.
- Done when: identical inputs produce the same snapshot id; a decision is refused without the
  permission; another tenant cannot see the queue.
- Verify: `pnpm --filter @rental/platform test`

---

## E. Access model

### [ ] C0-21 · Verticals, roles per vertical, partner members, and the unknown-path guard
- Size: L
- Depends on: C0-08
- Goal: a workspace can run cars, people can hold car roles, and unknown paths cost nothing.
- Change:
  - `tenants.verticals text[] not null default '{events}'`. The register page's `?vertical=cars`
    path sets `{cars}`.
  - `memberships.roles jsonb` holding a role per vertical (for example
    `{"events":"manager","cars":"counter_agent"}`), filled from today's `role`, which stays for
    now. Add car roles to `packages/core/src/permissions.ts` (or a new car permissions file in
    `packages/cars`): `counter_agent`, `fleet_manager`, `yard`, `damage_assessor`, `chauffeur`,
    `dispatcher`, with a car permission matrix.
  - `memberships.kind text default 'staff'` (`staff` | `partner`) and `partner_account_id`.
    `withTenant` sets `app.partner_id`; add `app_partner_visible()` in the style of
    `app_location_visible()`. No partner tables exist yet, so add only the function and a test.
  - **Unknown-path guard:** in the Next.js request hook (`proxy.ts` or `middleware.ts`; check the
    installed Next.js docs), reject paths whose first segment fails `SLUG_RE` or is in
    `RESERVED_SLUGS` with a static 404, before any session or database work. Cache "no such
    workspace" answers for 60 s.
- Done when: tests cover the role per vertical; a request for `/access` and for `/aaaaaaaa`
  produces zero SQL statements (assert with a query counter); existing workspace URLs still work.
- Verify: `pnpm test` and `node apps/web/scripts/e2e-phase0.mjs`

---

## F. Operations (owner or ops tasks, not code)

### [ ] C0-22 · Edge protection, mail authentication and recovery targets
- Size: M
- Blocked by: D16 (recovery targets)
- Goal: the baseline in `security.md` §4 "Now".
- Do:
  - Put a CDN and firewall in front of `app.renthatch.org` and `renthatch.org`. Turn on managed
    rules and DDoS protection.
  - Rate limits: 100 requests a minute per IP for pages, 20 a minute for 404 responses, 10 a
    minute for sign-in and reset. Challenge, then block, repeat offenders.
  - Cache 404 responses at the edge.
  - SPF, DKIM and DMARC at `p=reject` for `renthatch.org`.
  - Spend alerts on hosting, and on SMS when enabled.
  - Run at least two worker instances.
  - Record recovery targets (D16) and run one restore of the nightly backup into a scratch
    database. Write the steps in `docs/runbooks/restore.md`.
- Done when: a 2-minute request loop from one address at an unknown path is blocked at the edge;
  a restore has been done and timed.

### [ ] C0-23 · Error tracking, tracing and alerts
- Size: M
- Goal: failures are seen within minutes.
- Change:
  - Add an error tracker and OpenTelemetry to `apps/web` and `apps/worker`. Wrap `run()` in
    `apps/web/src/server/actions/run.ts` and the worker tasks.
  - Scrub personal data: no emails, phones, names, tokens or request bodies in events.
  - Dashboards and alerts: error rate, p95 response time, database pool saturation, job queue
    depth and oldest job age, failed messages, failed charges.
- Done when: a thrown test error appears in the tracker with the tenant id and no personal data;
  an alert fires in a test.
- Verify: trigger the test error in staging.

---

## G. Language

### [ ] C0-24 · Translation base and right-to-left kit
- Size: L
- Goal: Arabic can be added screen by screen.
- Change in `apps/web`:
  - Add an ICU message library (for example `next-intl`), with locale from the user's preference,
    then the workspace default. Locales: `en-US`, `en-AE`, `ar-AE`.
  - Set `lang` and `dir` on `<html>`.
  - Convert `src/components/kit/*` and `src/components/shell/*` from left/right utilities to
    logical ones (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`). Add a lint rule against new
    `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-` classes in those folders.
  - Move the kit's and shell's own strings into the catalog. Do not translate event screens.
  - A screenshot script that renders a kit sample page in `ar-AE` at 1440 and 390 px.
- Done when: the sample page mirrors correctly in Arabic; event screens look unchanged in English
  (compare screenshots from `shots-phase1.mjs`).
- Verify: `pnpm --filter @rental/web build` and the screenshot script.

---

## H. Close the phase

### [ ] C0-25 · Phase check
- Size: S
- Depends on: all above
- Do:
  - Run every event e2e script and the Odoo parity script if the env file is available.
  - Confirm each "Phase exit" line at the top of this file, with evidence in the PR description.
  - Update `docs/architecture.md` for what changed (roles, outbox, settings, headers).
  - Open the PR from `cars/phase-c0` into `main`.
