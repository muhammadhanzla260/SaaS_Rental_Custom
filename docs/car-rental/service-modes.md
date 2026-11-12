# Service modes: self-drive, chauffeur, transfers, insurance replacement

Status: proposal, for review. Written 10 Nov 2026.
Related: [booking-flow.md](./booking-flow.md) (gates, rules, settings),
[channels.md](./channels.md) (where bookings come from) and
[market-reference.md](./market-reference.md) (researched values).

A car booking has a **service mode**. It changes who drives, who pays, what is checked and how it is
priced. It does **not** change the engine: the same reservation, gates, rules, settings and money
apply. Every mode can be switched on or off per tenant, branch and channel.

| Mode | Who drives | Who pays | Priced by | New roles |
| --- | --- | --- | --- | --- |
| `self_drive` | the customer's drivers | customer / company / broker | day / week / month (booking-flow §2) | — |
| `chauffeur` | our **chauffeur** | customer / company | hour blocks, half/full day, multi-day | **chauffeur** (staff), **dispatcher** (staff) |
| `transfer` | our **chauffeur** | customer / company / hotel | point to point (zone matrix or distance) | same as chauffeur |
| `insurance_replacement` | the customer | **insurer** (authorised part) + customer (the rest) | insurer's authorised rate × days, plus extras | **adjuster** and **body shop** (external partners) |

Your instinct about roles is right. Chauffeur needs internal staff roles, and insurance replacement
needs **external partner** roles, which is a new kind of access (§4).

---

## 1. Chauffeur-driven

### 1.1 What the market does (researched, Dubai)
- Hourly booking with a **minimum of 2 to 5 hours** depending on the operator and car.
  - Sedans are about AED 100–150 per hour; premium cars about AED 180–250.
  - **Full day (8–10 h)** is about AED 700–1,500.
  - Monthly driver packages exist.
- Some operators include fuel and tolls inside the city. Out-of-city trips, overtime and waiting are
  extra.
- RTA-licensed *self-drive* hourly car sharing (Udrive, ekar) is a different product. It is
  self-drive with per-minute pricing, not chauffeur.
- OneClickDrive is expanding its chauffeur and luxury supplier base (Aug 2026). The demand is real
  in Dubai.

### 1.2 How it works in the product

**Booking (customer or staff).**
- The customer picks a mode, then a package: *hourly (min N)*, *half day*, *full day*, *multi-day
  (e.g. a wedding weekend)* or *monthly driver*.
- They pick a vehicle at class, model or specific-vehicle level.
- They give the pickup point and stops (an itinerary), the passenger name, the number of
  passengers and bags, and an optional flight.

**Requirements change automatically.** A preset rule says
`booking.service_mode = chauffeur → driver eligibility not required`. Instead it requires:
- a **lead passenger** (name, phone);
- the itinerary;
- the payment rule.

No customer licence or Emirates ID is needed, unless a tenant rule asks for ID (e.g. for VIP or
airport pickups).

**Availability needs two resources, a vehicle and a chauffeur:**
- The availability engine gets a **staff resource** type: chauffeur shifts, days off, maximum hours
  per day and minimum rest between jobs (all settings). Licence and permit expiry also count.
- A job holds both, using the same lock patterns as vehicles.
- Overlaps are refused by the database, with an exclusion constraint on the chauffeur's schedule.

**Pricing** (pure, configurable): base package, then overtime per block (e.g. 30 or 60 minutes),
then waiting time after the first N minutes. Further settings:
- out-of-city surcharge by zone or km;
- included km per package and excess per km;
- fuel and tolls included or passed through;
- night surcharge;
- meet-and-greet board;
- driver allowance for overnight trips;
- VAT.

**Dispatch board** (reuses the event crew board and live map):
- Unassigned jobs and drag-to-assign.
- Conflicts and rest-rule warnings.
- Live position, "driver en route" and "passenger on board".

**Chauffeur app** (the new offline-capable field app):
- Today's jobs and navigation.
- Statuses: *en route → arrived → passenger on board → stop → completed*.
- Waiting time captured automatically from timestamps.
- Odometer at start and end.
- Expenses (parking, tolls, fuel) with receipt photos.
- Passenger signature or confirmation.
- An incident report.

**Settlement:**
- Overtime and waiting are computed from the app's timestamps.
- Expenses are passed through or included, as configured.
- The receipt shows the timeline.

**Fines and tolls on chauffeured jobs** are matched to the chauffeur's job, not the customer. Each
tenant chooses whether they are absorbed, charged to the customer (tolls) or charged to the driver
(policy).

**Credentials:** chauffeur licence and commercial permits are tracked with expiry like vehicle
documents. An expired credential blocks assignment. The exact Dubai RTA permit types need checking.

### 1.3 Transfers (point to point)
These are the same as chauffeur, but priced by a **zone-to-zone matrix** (e.g. DXB → Marina) or by
distance, with flight tracking for airport pickups. They are popular with hotels. A **hotel or
concierge partner** can book them and earn a commission (§4).

### 1.4 Roles

| Role | Kind | Can |
| --- | --- | --- |
| `chauffeur` | staff | See only assigned jobs. Update statuses, odometer, expenses, photos, signatures. No prices or customer history beyond the job |
| `dispatcher` | staff | Assign and reassign jobs, manage shifts, see the live map (managers have it too) |

---

## 2. Insurance replacement

### 2.1 What the market does (researched)

**US:**
- The insurer, either the renter's own (rental reimbursement) or the at-fault party's (loss of use),
  **authorises** the rental. The adjuster gives the rental company a **claim number, a daily rate
  cap and a number of days**.
- The rental company **bills the insurer directly**.
- **Extensions** must be approved by the adjuster before the authorisation ends, typically when
  repairs take longer.
- The renter still usually leaves a **card for incidentals** (fuel, tolls, upgrades, days the
  insurer didn't authorise).
- Direct billing only works where the insurer has a relationship with that branch.
- Large insurers use electronic systems for this. Enterprise is the market leader, and TSD sells an
  electronic insurance-replacement product. Independents often still work by phone and email.

**UAE:**
- "Replacement car" cover is a popular motor policy add-on: typically **7 to 15 days**, capped per
  accident or per year.
- Insurers typically approve **about AED 70–100 per day**.
- The car comes **from a partner rental company**, or the insurer pays a cash allowance instead.
- The policyholder usually pays fuel, Salik, fines and parking.
- For non-fault accidents, the at-fault insurer provides the car for up to 15 days.
- One source says replacement cars are mandatory in Dubai policies. This could not be confirmed
  against a regulator and needs checking.

So in both markets, a GCC or US rental company signs agreements with insurers. That is a strong B2B
revenue line with steady volume.

### 2.2 How it works in the product

**Insurer accounts** (a company party with a contract). Each one sets:
- authorised rates per class and the default maximum days;
- whether CDW is included, and who pays the excess;
- required references (claim number, policy number, loss date, vehicle in repair, body shop);
- invoice format and grouping (per claim or a monthly statement);
- payment terms (e.g. net 30/45);
- whether extensions need approval, and auto-approve limits;
- portal access on or off;
- contacts and adjusters.

**Authorisation intake:**
1. An adjuster creates it in the **partner portal**; staff enter it from a phone call or email; or
   an email is parsed into a draft.
2. This creates a reservation with `service_mode = insurance_replacement`:
   - `bill_to` = insurer;
   - an **authorisation**: rate cap, days, class cap, coverage, references.
3. A body shop can refer the customer (partner portal or link). The car can be **delivered to the
   body shop** (a delivery mode).

**Requirements:**
- The normal driver rules apply (the customer drives).
- The customer's card for incidentals is a setting per insurer (on by default in the US).

**Extensions:**
- The renter or body shop asks for more days, and the adjuster gets a request in the partner portal
  (or by email with a secure link).
- The **approval inbox** is shared with internal approvals and agent proposals.
- If an extension isn't approved before the authorised end, the extra days become the customer's,
  with a notice (setting).

**Split billing at return.** Money lines are tagged with a payer:
- the **insurer** pays authorised days × the authorised rate (capped);
- the **customer** pays upgrade differences, days beyond the authorisation, fuel, tolls, fines,
  damage beyond coverage and extras.

There are two invoices from one order (the shared header supports several payers). The ledger keeps
**accounts receivable per insurer**, with aging and statement export.

**Repair status:** the body shop updates the estimated completion date in the portal. The return
date and extension requests follow it.

### 2.3 Roles (external partners)

| Role | Kind | Can see / do |
| --- | --- | --- |
| `partner_adjuster` | partner (insurer) | Create authorisations, approve or decline extensions, see the status and invoices of **their insurer's** claims only |
| `partner_bodyshop` | partner (body shop) | Refer customers, update repair dates, see status of **their referrals** only |
| `partner_referrer` | partner (hotel, concierge, agency) | Book transfers or rentals for guests and see their commission statement |
| `corporate_booker` | partner (company) | Book for authorised drivers and see their company's bookings and statements |

---

## 3. Where each mode differs (all configurable, same engine)

| Area | Self-drive | Chauffeur / transfer | Insurance replacement |
| --- | --- | --- | --- |
| Gate B (confirm) | payment rule | payment rule | authorisation present |
| Gate C (hand-over) | verified drivers, signed, deposit | chauffeur assigned + credentials valid, vehicle ready | verified driver, signed, incidentals card (setting) |
| Availability | vehicle (class / model / VIN) | vehicle + chauffeur | vehicle (class cap from authorisation) |
| Pricing | rate plans | packages + overtime + waiting | authorised rate × days, plus customer extras |
| Deposit | strategy by class | usually none (setting) | per insurer setting |
| Bill-to | customer / company / broker | customer / company / hotel partner | insurer + customer split |
| Tolls and fines | to the customer | to the job (absorb, charge or driver) | to the customer (policyholder) |
| Field app | check-out / check-in | chauffeur job flow | check-out / check-in (+ body shop delivery) |

---

## 4. Access model change: partner memberships

Today a membership is a staff member of one workspace, optionally limited to some locations. Two
new access kinds are needed:

1. **Staff** (as today), with **roles per vertical**. The cars roles are counter agent, fleet
   manager, yard, damage assessor, chauffeur and dispatcher.
2. **Partner members.** A login (same shared `users` table) linked to a **partner account** (an
   insurer, body shop, hotel/referrer or corporate customer) inside one workspace.
   - Row-level security adds a **partner scope** next to the location scope: `app.partner_id` is
     set per transaction, and policies only return rows linked to that partner (their claims,
     referrals or company bookings).
   - Partners use a separate, simple **partner portal**, not the staff app.
   - Permissions come from the same matrix, with partner-only permissions.
   - Unknown or foreign ids return 404, as everywhere else.
   - Every partner action is audited.

**Customers** keep using the portal by verified link or OTP. They are not memberships.

This follows the same proven pattern as today's location scope (`app.location_ids`), which the
database already enforces. It's a contained change, not a redesign.
