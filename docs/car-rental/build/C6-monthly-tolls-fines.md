# C6 · Monthly rentals, tolls, fines, maintenance, incidents (weeks 25–28)

Branch: `cars/phase-c6`. Design references: [architecture.md](../architecture.md) §6.4, §13.12,
§13.13, [market-reference.md](../market-reference.md) §1.1 and cases R5, R7.

**Phase exit**
- Three monthly cycles reconcile, with excess km and a vehicle swap.
- ≥ 95% of lines in a real Salik statement auto-match, and no line is charged twice.
- An investor-owned car produces a correct owner statement.

---

### [ ] C6-01 · Monthly rentals
- Size: L
- Change: billing cycles on an agreement (`cars.billing_cycles`), an invoice per cycle, auto-charge
  of the saved card on the cycle date with retry and alerts, km allowance per cycle with excess
  at cycle end, notice period and auto-renew settings, scheduled service swaps. Revenue is
  recorded per cycle in the ledger.
- Done when: a fake-clock test runs three cycles with excess km and a swap, and the ledger
  balances (reference case R7).

### [ ] C6-02 · Statement import framework
- Size: L
- Change: `cars.statements` and `cars.statement_lines` (source, plate, time, place, amount,
  reference, raw row, hash). Mapping templates per source (column names, date formats, time
  zone). Dry-run with row errors. Each line is unique by source + reference or by hash, so a
  re-import adds nothing. Templates for Salik and Darb exports.
- Done when: importing the same file twice creates no new lines; a malformed row is reported with
  its line number.

### [ ] C6-03 · Matching lines to rentals
- Size: L
- Depends on: C6-02, C5-02
- Change: match by plate and time against agreement periods from `cars.vehicle_blocks`, in the
  branch time zone. Unmatched or ambiguous lines go to an exceptions queue with the reason
  (vehicle in prep, staff movement, plate unknown). Manual match and "absorb" actions.
- Done when: tests cover a crossing one minute before check-out and one minute after check-in,
  a swap mid-rental, and an unknown plate.

### [ ] C6-04 · Post-rental charges and collection
- Size: L
- Depends on: C6-03, C3-07
- Change: `cars.post_rental_charges`: pass-through amount from the statement plus the admin fee
  from settings, with tax from the tax engine. Collect from the retained deposit first, then a
  merchant-initiated charge on the saved card under the signed consent. A customer notice with
  the evidence (gate or location, time, plate), shown in the portal. Idempotency key per
  statement line.
- Done when: reference case R5 passes; running collection twice charges once.

### [ ] C6-05 · Traffic fines and disputes
- Size: L
- Depends on: C6-04
- Change: mapping templates for Dubai Police and Sharjah fine exports (confirm formats with the
  pilot), fine-specific fields (violation, black points), a dispute workflow started from the
  portal or by staff, which pauses collection until decided.
- Done when: a disputed fine is not collected until staff decide; the decision is audited.

### [ ] C6-06 · Deposit release with a legal cap
- Size: M
- Depends on: C6-04
- Change: a job that releases what is left of each deposit on its due date, and always before
  the country cap (30 days in Dubai; flagged "verify"). The portal lists every deduction with
  its evidence.
- Done when: fake-clock tests show release on day 21 by default and no later than the cap even
  with open exceptions (which then alert staff).

### [ ] C6-07 · Maintenance
- Size: L
- Change: `cars.maintenance_plans` (by km or by date, per class or vehicle), `cars.work_orders`
  (vendor, cost, status). A due item creates a vehicle block; an overdue item prevents
  assignment. Registration and insurance expiry alerts. Reuse ideas from `maintenance_tickets`.
- Done when: a vehicle due for service inside a requested rental is not proposed by the
  assignment solver.

### [ ] C6-08 · Incidents and fleet insurance claims
- Size: L
- Change: `cars.incidents` (accident, theft, impound; police report file; third party; photos)
  and `cars.claims` (insurer, policy, reference, amounts, status), linked to a work order and to
  time off the road. An incident can block the vehicle and start a damage case against the
  customer.
- Done when: an incident without a police report cannot move to "claim submitted" when the
  country rule requires one.

### [ ] C6-09 · Investor-owned and hired-in vehicles
- Size: L
- Blocked by: D15 only for the contract-registry part
- Change: owner accounts with a revenue-share rule and a monthly **owner statement** (rental
  revenue, deductions, share due), recorded as a payable in the ledger. Hired-in vehicles carry a
  supplier, a cost and a period, and add supply only for that period. A `ContractRegistry` port
  with no adapter yet.
- Done when: an owner statement for a month matches the ledger; a hired-in car is not offered
  outside its period.

### [ ] C6-10 · Reporting schema and fleet reports
- Size: L
- Change: schema `reporting` fed by outbox subscribers; `reporting.fleet_daily` (per vehicle and
  day: status, branch, on rent, revenue). Reports: utilization, revenue per available unit,
  revenue by class and branch, no-show rate by channel, readiness rate, toll and fine recovery,
  receivables aging. CSV export and the weekly email reuse the existing report plumbing.
- Done when: report figures match hand-computed values on a seeded month; reports read from the
  replica when one is configured.

### [ ] C6-11 · Screens: statements, exceptions, charges, maintenance, incidents, owners, reports
- Size: L (each screen is its own session)
- Blocked by: design

### [ ] C6-12 · Phase check
- Size: S
- Blocked by: D7 (a real statement from the pilot operator for the 95% check)
- Do: confirm the phase exit lines; run all event tests; open the PR.
