# C1 · Fleet, catalog, rates, policies, presets (weeks 6–9)

Branch: `cars/phase-c1`. Needs C0 merged. Design references: [architecture.md](../architecture.md)
§6, [booking-flow.md](../booking-flow.md) §2–5, [market-reference.md](../market-reference.md).

Screens in this phase are marked "Blocked by: design". Build their commands, queries and tests
first.

**Phase exit**
- The rate golden suite prices 30+ scenarios in AED to the minor unit, plus OMR cases.
- Reference cases R1–R8 pass as saved rule tests.
- A locked rule cannot be loosened; every rule that fires is explained.

---

### [ ] C1-01 · `@rental/cars` package and the `cars` schema
- Size: S
- Goal: a home for car code and tables.
- Change: new package `packages/cars` with the context folders `fleet`, `rates`, `policies`,
  `reservations`, `drivers`, `agreements`, `inspections`, `postrental`, `maintenance` (empty for
  now). Migration: `CREATE SCHEMA cars`, grants for `rental_app`. Add the package to
  `transpilePackages` and to the boundary rules.
- Done when: `pnpm boundaries` and `pnpm typecheck` pass.

### [ ] C1-02 · Paging and search helpers
- Size: M
- Goal: lists scale from day one.
- Change: in `packages/platform/src/query/`: keyset paging (`{ items, nextCursor }`, max page
  size 100) and a search helper. Migration: `CREATE EXTENSION pg_trgm`.
- Done when: tests page through 1,000 rows with stable order and no duplicates.

### [ ] C1-03 · Vehicle classes and models
- Size: M
- Depends on: C1-01
- Change: tables `cars.classes` (name, ACRISS code, tags, seats, bags, transmission, fuel,
  `booking_level` class | model | vehicle, minimum age, sort, status) and `cars.models` (class,
  make, model, year, photos). `cars.class_upgrades` (from class, to class, kind free | paid, rank).
  Commands: create, update, archive. Queries: list, get.
- Done when: tests cover CRUD, tenant isolation, ACRISS format check, and an upgrade ladder with
  no cycles.

### [ ] C1-04 · Vehicles
- Size: L
- Depends on: C1-03
- Change: `cars.vehicles`: VIN (17 characters with check-digit validation where the VIN format
  has one), plate, plate source (emirate or state), class, model, home branch, colour, odometer,
  fuel or charge level, status (`available`, `on_rent`, `prep`, `maintenance`, `blocked`,
  `missing`, `disposed`), **ownership** (`owned`, `leased`, `investor`, `hired_in`) with owner or
  supplier reference and period, **cost fields** (purchase or lease cost, start date), Salik tag
  id. `cars.vehicle_documents` (registration, insurance) with expiry. Trigram indexes on plate
  and VIN. Status changes only through commands that record a reason.
- Done when: tests cover uniqueness of VIN and plate per workspace, status transitions, expiry
  queries, and search by partial plate.

### [ ] C1-05 · Fleet CSV import
- Size: M
- Depends on: C1-04
- Change: a command that validates a CSV in dry-run mode, returns row errors, then imports in one
  transaction. Reuse the pattern of the customer import in `packages/db/src/services/customers.ts`.
- Done when: a 500-row file imports in under 10 s; a bad row reports its line and reason and
  imports nothing.

### [ ] C1-06 · Branch settings for cars
- Size: M
- Change: car settings on locations through the settings registry: branch type (airport, city,
  delivery-only), opening hours (reuse `businessHoursSchema`), after-hours pickup and return
  rules, turnaround minutes per class. Table `cars.delivery_zones` (branch, name, polygon as
  GeoJSON, fee rule, lead time, slots) and `cars.one_way_fees` (from branch, to branch, fee).
- Done when: point-in-polygon tests pass; an address outside every zone returns "not served".

### [ ] C1-07 · Extras, protection, mileage and fuel products
- Size: M
- Change: `cars.extras` (tracked or not, pricing per day | per rental | per day capped, taxable,
  stock per branch for tracked ones), `cars.protection_packages` (name, daily price by class,
  excess amount), `cars.mileage_plans` (included km per day and per month, excess per km by
  class, unlimited flag), `cars.fuel_options`.
- Done when: CRUD and isolation tests pass.

### [ ] C1-08 · Rate plans
- Size: M
- Depends on: C1-03
- Change: `cars.rate_plans` (name, type daily | monthly, pay-now or pay-later, valid dates,
  channels) and `cars.rates` (plan, class or model or vehicle, branch optional, hourly, daily,
  weekly, monthly, weekend daily). `cars.seasons` (date range, percentage or override rates).
  `cars.lor_tiers` (minimum days → discount).
- Done when: overlapping seasons are rejected or ordered by an explicit priority; tests cover
  both.

### [ ] C1-09 · The rate engine (pure)
- Size: L
- Depends on: C0-02, C1-07, C1-08
- Change: `packages/cars/src/rates/domain/quote.ts`: `quote(input) → { lines, totals, trace }`.
  - Billable periods: 24 hours from pickup plus grace minutes.
  - Best of day, week and month combinations.
  - Weekend days from the branch calendar; seasons; length-of-rental tiers.
  - Extras (per day, capped, per rental), protection, fees (airport, delivery, one-way,
    after-hours, young driver, extra driver).
  - Discounts and coupons; tax through a `TaxEngine` port (C1-10).
  - Monthly plans: price per cycle, included km per cycle.
  - Every line carries a trace that explains it.
- No database access. All amounts are `Money`.
- Done when: unit tests plus a golden file of 30+ AED scenarios and 5 OMR scenarios pass. Include:
  9 days where the weekly rate wins; a weekend rate crossing Saturday; a Marina delivery that is
  free at 3 days and charged at 2; a monthly plan.

### [ ] C1-10 · Tax engine port with VAT
- Size: M
- Change: `packages/platform/src/tax/`: `TaxEngine` interface (`components(jurisdiction, lines)`),
  and a table-driven implementation with UAE VAT 5% and Oman VAT 5%, inclusive or exclusive
  display, and rounding per line then total. The events path is not changed.
- Done when: tests cover inclusive and exclusive prices agreeing to the minor unit, and a
  zero-rated line.

### [ ] C1-11 · Policies, the UAE country pack and the Dubai presets
- Size: L
- Depends on: C0-18, C0-19, C1-09
- Change:
  - `cars.policies`: cancellation tiers, no-show, modification and repricing, deposit (strategy,
    amount by class, release days, no-deposit surcharge), late return (grace, hourly threshold,
    separate rule for extras). Versioned, with `effective_from`.
  - Country pack `AE` (with `AE-DU`, `AE-SHJ`): locked rules for documents by residency, the
    deposit release cap, VAT display. Lists that are unverified carry a `verify: true` flag
    shown in Settings.
  - Presets "Dubai standard", "Dubai luxury" and "Monthly UAE" that fill settings, rules,
    policies and sample products. Values from `market-reference.md` §1.1.
  - Reference cases R1–R8 as saved rule tests.
- Done when: applying a preset to an empty workspace yields a bookable configuration; R1–R8 pass;
  a tenant rule that loosens a locked rule is refused.

### [ ] C1-12 · Rule test bench, impact preview and test mode
- Size: L
- Depends on: C1-11
- Change:
  - Query `rules.explain(sampleBooking)` returning fired rules, fees, documents, gates and price.
  - Saved cases run before a publish; a failing case blocks the publish unless confirmed.
  - Impact preview: evaluate a draft against the last 30 days of bookings and report how many
    would change (returns 0 until bookings exist).
  - `tenants.test_mode`: when on, bookings are flagged as test, no real messages are sent, and
    the gateway is forced to test keys.
- Done when: tests cover a blocked publish and a test-mode booking that sends nothing.

### [ ] C1-13 · Screens: fleet, classes, rates, policies, settings
- Size: L (each screen is its own session)
- Blocked by: design
- Change: `apps/web/src/app/[tenant]/cars/…`: fleet list with search and paging, vehicle page,
  classes, rate plans, extras and protection, policies, branch car settings, the generated
  Settings UI from the registry, and the rule bench. Navigation shows the cars section only when
  the workspace has the `cars` vertical. All strings through the message catalog.
- Done when: an e2e script `apps/web/scripts/e2e-cars-c1.mjs` creates a class, a vehicle, a rate
  plan and applies a preset, at 1440 and 390 px, in English and Arabic.

### [ ] C1-14 · Phase check
- Size: S
- Do: confirm the phase exit lines; run all event tests; open the PR.
