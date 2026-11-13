# Build pack: car rental

This folder turns [dev-plan.md](../dev-plan.md) into tasks. Each task is sized for one Claude Code
session (roughly half a day to two days of work) and states what to change, how to check it, and
what it depends on.

Start with [C0-foundations.md](./C0-foundations.md), task **C0-01**.

## Phase files

| File | Phase | Weeks | Branch | Ready to start? |
| --- | --- | --- | --- | --- |
| [C0-foundations.md](./C0-foundations.md) | Foundations and security baseline | 1–5 | `cars/phase-c0` | **Yes** |
| [C1-fleet-rates.md](./C1-fleet-rates.md) | Fleet, catalog, rates, policies, presets | 6–9 | `cars/phase-c1` | After C0. Screens need designs |
| [C2-booking-core.md](./C2-booking-core.md) | Booking core, risk, live updates | 10–14 | `cars/phase-c2` | After C1. Screens need designs |
| [C3-payments.md](./C3-payments.md) | Payments, webhooks, disputes, ledger, invoices | 13–16 | `cars/phase-c3` | Needs D1 and D4 |
| [C4-drivers-kyc-channels.md](./C4-drivers-kyc-channels.md) | Drivers, KYC, media, portal, WhatsApp inbox | 17–20 | `cars/phase-c4` | Needs D5 and D6 |
| [C5-field-app.md](./C5-field-app.md) | Offline field app: hand-over, return, delivery | 21–24 | `cars/phase-c5` | After C4. Needs the UAE cell |
| [C6-monthly-tolls-fines.md](./C6-monthly-tolls-fines.md) | Monthly, tolls, fines, maintenance, incidents | 25–28 | `cars/phase-c6` | Needs D7 and D15 |
| [C7-billing-hardening.md](./C7-billing-hardening.md) | SaaS billing, security hardening, pilot readiness | 29–31 | `cars/phase-c7` | Needs D12 |
| [C8-agents.md](./C8-agents.md) | Agent platform, boundaries, three pilot agents | 6–31 | `cars/agents` | After C0. Needs D14 |
| [C9-uae-cell.md](./C9-uae-cell.md) | UAE cell, central login store, e-invoicing | 10–24 | `cars/uae-cell` | Needs D2 and D3 |
| [C10-ga.md](./C10-ga.md) | GA hardening | 36–38 | `cars/phase-c10` | After the pilot |

C0 is detailed down to files and checks. Later phases are detailed down to tasks and acceptance
checks. Before each later phase starts, re-read its file against what was actually built, and add
file-level detail to its tasks.

## Task format

```
### [ ] C0-07 · Title
- Size: S (≤ half a day) · M (about a day) · L (about two days)
- Depends on: task ids
- Blocked by: an owner decision (D-number) or "design"
- Goal: one sentence
- Change: files and what to do
- Done when: checks a reviewer can run
- Verify: commands
```

A task is done when its "Done when" checks pass, `pnpm typecheck` and `pnpm test` pass, and its
checkbox is ticked.

## Decisions already made (do not reopen in a task)

| Decision | Choice |
| --- | --- |
| Pilot | One Dubai operator, self-drive, daily and monthly rentals |
| Logins | One login for all regions, in a central login store |
| Companies | One company and one currency per workspace. Legal entities are deferred |
| Orders | Thin shared header `orders` + detail tables per vertical |
| Users and customers | Shared. Car-only driver and ID data lives in car tables |
| ID documents | Never accepted in chat. Secure upload link only |
| Event rentals | Keep the existing flow |
| Agents | Each has a job charter. A violation ends the run at once |

## Decisions still open (tasks that need them are marked "Blocked by")

| # | Decision | Blocks |
| --- | --- | --- |
| D1 | GCC payment gateway | C3-04 |
| D2 | UAE cell hosting | C9 |
| D3 | Legal sign-off on residency and the central login store | C9-06 |
| D4 | Default deposit strategy | C3-07 |
| D5 | KYC vendor | C4-05 |
| D6 | Document and licence lists for the UAE | C1-11 (ships marked "verify") |
| D7 | The Dubai pilot operator | C6, C7-08 |
| D12 | SaaS pricing | C7-03 |
| D14 | AI model region for Gulf data | C8-10 |
| D15 | Government contract registration rules | C6-09 |
| D16 | Recovery targets | C0-22 |

## Conventions for new code

**Packages.** Three new workspace packages. A context is a folder inside one, not its own package.

```
packages/kernel/src/            money/ time/ contract/ rules/ result/
packages/platform/src/<context>/{contract,domain,app,infra,tests}/
packages/cars/src/<context>/{contract,domain,app,infra,tests}/
```

Each package's `exports` map exposes only `./<context>` → `src/<context>/contract/index.ts`.

**Database.**
- Car tables live in the Postgres schema `cars`; new shared tables in `platform`. Existing tables
  stay in `public`.
- Drizzle table definitions sit in the context's `infra/schema.ts`. All migrations stay in
  `packages/db/migrations`, generated with `pnpm --filter @rental/db generate`, then edited to add
  RLS and SQL functions.
- Every new tenant table: `tenant_id`, primary key `(tenant_id, id)`, composite foreign keys, and
  `SELECT app_enable_tenant_rls('<schema>.<table>')` in the same migration.
- Money columns: `<name>_minor bigint` plus a `currency text` column on the row.

**Commands.** Defined with `defineCommand` (task C0-03). A handler does, in one transaction:
validate input → check permission and `assertWritable` → load → pure domain function → save →
audit → outbox event. Handlers return `Result`, never throw for expected failures.

**Tests.**
- Pure domain: `*.test.ts` next to the code.
- Database: in the context's `tests/`, connecting as `rental_app`, with a tenant-isolation case for
  every new table.
- Anything that can race gets a concurrency test.

**Screens.** Server components by default, the existing kit in `apps/web/src/components/kit`, no
new UI library. A task marked "Blocked by: design" needs a screen design before its UI is built;
its commands, queries and tests can be built first.

## What is not in this pack

- Screen designs for cars.
- Vendor contracts and credentials (gateway, KYC, WhatsApp, e-invoicing provider).
- Legal review results for the items marked "verify" in [market-reference.md](../market-reference.md)
  and [security.md](../security.md).
- Post-pilot waves P1–P7. They get their own task files after the pilot.
