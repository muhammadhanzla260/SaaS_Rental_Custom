# C5 · Offline field app: hand-over, return, delivery (weeks 21–24)

Branch: `cars/phase-c5`. This is new work: the coach portal has no offline support. Design
references: [architecture.md](../architecture.md) §6.3, §13.7,
[booking-flow.md](../booking-flow.md) §6.2.

**Phase exit**
- Check-out takes ≤ 2 minutes for a ready booking on a mid-range phone with the network off, and
  syncs when the network returns.
- The settlement golden suite passes.
- A changed photo or condition report is detected by the integrity check.
- A deposit is released automatically after a clean return.

---

### [ ] C5-01 · Installable offline app shell
- Size: L
- Change: under `apps/web/src/app/field/[tenant]/…`: a web app manifest, a service worker that
  caches the shell and today's jobs, an IndexedDB store for jobs and a queue of pending actions
  and photos, and background sync with retry. Each queued action carries an idempotency key and
  the device time. Reuse `apps/web/src/lib/shrink-image.ts` for photos.
- Done when: with the network off, a job opens, actions queue, and everything syncs once on
  reconnect with no duplicates (automated with a browser test).

### [ ] C5-02 · Rental agreement aggregate
- Size: L
- Change: `cars.rental_agreements` (reservation, vehicle, opened and closed times, readings out
  and in: odometer, fuel or charge level), `cars.agreement_amendments` (extension, swap, early
  return). Opening requires Gate C and takes the serialized vehicle block. Readings in must not
  be lower than readings out.
- Done when: tests cover refusal without Gate C, the vehicle block, and reading checks.

### [ ] C5-03 · Condition reports with evidence integrity
- Size: L
- Depends on: C4-01, C5-02
- Change: `cars.condition_reports` (agreement, kind out | in, photos with hash and server time,
  damage marks by zone with severity, fuel, odometer, signatures, previous report hash, own
  hash). Immutable once signed. A verification function that recomputes the chain.
- Done when: tests show that altering a photo record or a report breaks verification.

### [ ] C5-04 · Check-out flow
- Size: L
- Blocked by: design
- Depends on: C5-01, C5-03
- Change: confirm the vehicle by plate or VIN, guided walk-around (configurable photo angles),
  tap-to-mark damage diagram, fuel and odometer with photo, customer signature, hand over keys →
  agreement opened, reservation `OnRent`.
- Done when: the timed e2e run meets the 2-minute target offline.

### [ ] C5-05 · Check-in flow
- Size: L
- Blocked by: design
- Depends on: C5-04
- Change: the same walk-around with the check-out photos side by side, marking of new damage,
  readings in, customer signature or "customer not present".
- Done when: new damage creates a draft damage case with both photos attached.

### [ ] C5-06 · Settlement (pure) and deposit release
- Size: L
- Depends on: C3-07, C5-02
- Change: `packages/cars/src/agreements/domain/settle.ts`: extra km against the plan, fuel
  shortfall with service fee, late return (grace, hourly up to the threshold, then a day; extras
  under their own rule), cleaning fees, confirmed damage capped by the protection excess. The
  handler posts charges, captures from the deposit, schedules the release, issues the final
  invoice and sends the receipt.
- Done when: a golden suite of 15+ settlements passes, including reference case R4.

### [ ] C5-07 · Damage cases
- Size: M
- Depends on: C5-05
- Change: `cars.damage_cases` (linked reports and photos, estimate from a repair price list,
  liability, status). A charge needs a confirmed case, made by a person with the permission.
- Done when: an unconfirmed case cannot produce a charge.

### [ ] C5-08 · Delivery and collection tasks
- Size: L
- Blocked by: design
- Change: a `cars.handover_tasks` table (delivery or collection, address, window, assigned
  member, status) created from the reservation's pickup and return modes. Assignment and a live
  map reuse the crew board patterns in `apps/web/src/app/[tenant]/crew`. The task runs in the
  field app and ends in the check-out or check-in flow at the address.
- Done when: a delivery booking produces a task, and its completion opens the agreement.

### [ ] C5-09 · Extensions, early returns and swaps
- Size: L
- Depends on: C5-02
- Change: commands that re-check availability, re-quote under the locked terms or the repricing
  setting, record an amendment, and move the vehicle block. Extensions can be requested from the
  portal and need payment or approval by setting.
- Done when: an extension that collides with another booking is refused or routed to approval;
  a swap keeps both vehicles' histories correct.

### [ ] C5-10 · Yard board
- Size: M
- Blocked by: design
- Change: a live board of due out, due in, late, ready or incomplete, prep queue, and delivery
  tasks, per branch.
- Done when: a check-in on a phone moves the card on the board within 2 s.

### [ ] C5-11 · Phase check
- Size: S
- Do: confirm the phase exit lines on a real mid-range phone; run all event tests; open the PR.
