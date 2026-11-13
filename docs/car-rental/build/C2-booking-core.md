# C2 · Booking core, risk checks, live updates (weeks 10–14)

Branch: `cars/phase-c2`. Needs C1 merged. Design references:
[booking-flow.md](../booking-flow.md) (all), [architecture.md](../architecture.md) §6.0, §6.2,
§13.5, §13.6.

**Phase exit**
- 50 parallel holds for the last car produce exactly 1 success.
- A vehicle-level double hold is rejected by the database.
- A high-risk booking cannot be confirmed without approval.
- A counter booking for a returning customer takes ≤ 90 s (e2e timing).
- A change on one screen appears on another within 2 s.
- Reservation commit p95 ≤ 250 ms on a 1,000-vehicle seed.

---

### [ ] C2-01 · Prototype: one car booking on the shared header
- Size: L
- Goal: prove the header before building on it.
- Change: the thinnest path that works end to end with no screens: create an `orders` row with
  `vertical = 'cars'` plus a minimal `cars.reservations` row → record a deposit payment → derive
  an invoice → refund → see it in one report. Use existing payment and invoice services through
  the `VerticalAdapter`.
- Done when: the test passes **without** adding a car column to `orders` and **without** a
  vertical comparison in platform or event code. If either is needed, stop and write the finding
  in this file before continuing.

### [ ] C2-02 · Reservation tables and header integrity
- Size: L
- Depends on: C2-01
- Change:
  - `cars.reservations` (same id as the header, `vertical` fixed to `'cars'`, composite foreign
    key `(tenant_id, id, vertical)` to `orders`), with the columns in `booking-flow.md` §9.
  - `cars.reservation_parties`, `cars.reservation_extras`.
  - A deferred constraint trigger: every `orders` row with `vertical = 'cars'` has exactly one
    reservation row at commit.
  - A cars `VerticalAdapter` and the status → stage mapping in `booking-flow.md` §7.
- Done when: tests show a car row cannot attach to an event order, a header without a detail row
  fails at commit, and other tenants see nothing.

### [ ] C2-03 · Availability: class and model levels
- Size: L
- Change: SQL functions in the style of `app_reserve_inventory`:
  - `cars.app_class_supply(class, branch, from, to)`: vehicles in the class at the branch, minus
    blocks, plus planned one-way arrivals, plus hired-in vehicles for their period.
  - `cars.app_hold_class(reservation, class | model, branch, from, to)`: advisory lock on tenant
    + class + branch; checks supply minus overlapping holds plus the overbooking allowance;
    inserts into `cars.capacity_holds` with the turnaround buffer.
  - Overdue rentals count as occupying their vehicle until checked in.
- Done when: a concurrency test with 50 parallel holds for one remaining car yields 1 success;
  the allowance of +1 yields 2; tests cover the buffer and one-way supply.

### [ ] C2-04 · Availability: vehicle level and blocks
- Size: M
- Change: `cars.vehicle_blocks(tenant_id, vehicle_id, period tstzrange, kind, ref)` with
  `EXCLUDE USING gist (tenant_id WITH =, vehicle_id WITH =, period WITH &&)`. Kinds: reservation
  hold, agreement, maintenance, transfer, manual. Commands to block and release.
- Done when: two overlapping blocks on one vehicle fail in the database; adjacent blocks succeed.

### [ ] C2-05 · Availability projection for search
- Size: M
- Depends on: C2-03
- Change: `cars.class_availability` (branch, class, day, free count) kept current by outbox
  subscribers, and a query `cars.search.offers` that reads it, prices each offer with the rate
  engine, and flags restrictions from the rules engine using declared facts.
- Done when: search + quote p95 ≤ 400 ms on a 1,000-vehicle seed; the authoritative hold still
  rejects when the projection is stale.

### [ ] C2-06 · Reservation state machine and gates
- Size: L
- Depends on: C2-02, C0-20
- Change: pure state machine in `packages/cars/src/reservations/domain/` (Draft, Held,
  PendingApproval, Confirmed, Ready, OnRent, Expired, Declined, Cancelled, NoShow) and
  `readiness(reservation, facts)` returning the checklist for gates A, B and C from invariants
  plus rule effects. Gate C accepts verified facts only (stubbed until C4).
- Done when: unit tests cover every transition, every illegal transition, and deferral of
  requirements to a later gate.

### [ ] C2-07 · Reservation commands
- Size: L
- Depends on: C2-03, C2-04, C2-06
- Change: `cars.reservations.hold`, `update`, `addParty`, `removeParty`, `confirm`, `modify`,
  `cancel`, `markNoShow`, and the `readiness` query. Each write takes an idempotency key, supports
  dry run, returns the explained quote and the checklist, locks the policy snapshot at confirm,
  records a version, audits, and emits an event.
- Done when: tests cover a repeated request returning the first result, optimistic version
  conflicts, repricing under each `cars.modify.reprice` setting, and cancellation fees from the
  locked policy.

### [ ] C2-08 · Hold expiry and no-show jobs
- Size: M
- Depends on: C2-07, C0-15
- Change: scheduled work that expires unpaid holds (with a reminder before) and marks no-shows
  after the grace period, extended by a recorded flight delay. Both release capacity.
- Done when: tests with a fake clock cover expiry, reminder, grace and release.

### [ ] C2-09 · Risk signals and score
- Size: L
- Change: `packages/platform/src/risk/`: collect signals at Hold and before Confirm (bookings per
  card fingerprint, phone, email, device and IP in a window; name mismatches; blacklist hits;
  customer history; card country against licence country when known). A pure `score(signals)`
  with weights from settings. Expose `risk.score` and `risk.signals` as rule facts. Default rules
  in the presets: high score → approval; very high → deny.
- Done when: tests show a high score blocks `confirm` until an approval is decided, and the
  decision is audited.

### [ ] C2-10 · Live updates
- Size: L
- Blocked by: Redis being provisioned (ops)
- Change: an outbox subscriber publishes compact change events to Redis; a streaming route in
  `apps/web` (server-sent events) checks workspace, branch scope and partner scope on connect and
  forwards matching events; a small client hook refreshes the affected part of the screen. Keep
  `LiveRefresh` as the fallback.
- Done when: a test client receives an event for its workspace within 2 s and never one for
  another workspace or an out-of-scope branch.

### [ ] C2-11 · One search box
- Size: M
- Depends on: C1-02
- Change: a query that searches customers, vehicles and reservations by name, phone, plate, VIN
  and booking number, with trigram indexes, scoped by RLS, returning typed results. Wire it to
  the existing command palette.
- Done when: p95 ≤ 150 ms on the seed; tests cover partial plate and phone matches.

### [ ] C2-12 · Screens: counter builder, reservations list, approvals
- Size: L (each screen is its own session)
- Blocked by: design
- Change: the one-screen reservation builder with a "Still required" sidebar (pattern:
  `apps/web/src/app/[tenant]/orders/builder`), live quote from the pure engine in the browser
  with server re-check, customer lookup, approvals inbox screen, reservations list with paging.
- Done when: `e2e-cars-c2.mjs` books for a returning customer in ≤ 90 s and shows an approval
  flow, at 1440 and 390 px, in English and Arabic.

### [ ] C2-13 · Screen: fleet calendar
- Size: L
- Blocked by: design
- Change: a virtualized Gantt by vehicle and by class over 14 days, with drag to assign or swap
  (calls the block and assignment commands), overdue and at-risk markers, live updates.
- Done when: 500 vehicles × 14 days render first paint in ≤ 1.5 s; a drag that would overlap is
  refused with the server's reason.

### [ ] C2-14 · Vehicle assignment
- Size: M
- Depends on: C2-04
- Change: a pure solver that proposes a VIN for a class or model reservation (same branch, no
  service due within the rental, lower mileage first), and commands to assign, unassign and swap.
- Done when: tests cover the ordering and a refusal when no vehicle fits.

### [ ] C2-15 · Phase check
- Size: S
- Do: run the concurrency suite, the performance checks and all event tests; confirm the phase
  exit lines; open the PR.
