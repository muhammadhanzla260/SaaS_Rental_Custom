# C10 · GA hardening (weeks 36–38, GA in week 39)

Branch: `cars/phase-c10`. Starts after the 4-week pilot. Re-plan this file from the pilot's
findings before starting.

**Phase exit**
- Pilot issues rated high are fixed.
- Load test at 10× pilot volume meets the speed budgets.
- Second penetration test has no open high-severity finding.

---

### [ ] C10-01 · Pilot fixes
- Size: L
- Do: triage the pilot's issue list; fix high and medium items; turn the pilot's real past
  bookings into pricing and settlement golden cases.

### [ ] C10-02 · Booking websites on the operator's domain
- Size: L
- Blocked by: design
- Change: domain verification, routing by host name at the edge, cached class and price pages,
  structured data for search engines, `robots.txt` and sitemap per site.
- Done when: a verified custom domain serves the booking flow with a valid certificate.

### [ ] C10-03 · Public API, OAuth apps and scoped keys
- Size: L
- Change: REST endpoints generated from the contract registry with OpenAPI docs, a version
  policy, idempotency keys on writes, quotas per key and workspace, hashed and expiring API
  keys, OAuth apps with scopes, and signed outgoing webhooks with a delivery log and replay.
- Done when: the API security checks in [security.md](../security.md) §3.6 each have a test.

### [ ] C10-04 · Accounting exports and importers
- Size: L
- Change: a general-ledger export (CSV first, then one accounting system the pilot uses), and
  importers for fleet, customers and open bookings from a generic CSV.

### [ ] C10-05 · Load test and tuning
- Size: M
- Do: seed 10× the pilot's volume; test search, booking, check-in and statement import; fix what
  misses the budgets in [architecture.md](../architecture.md) §8.

### [ ] C10-06 · Second penetration test and assurance
- Size: M
- Do: re-test after C10-03; start the SOC 2 audit period; complete the vendor register per cell.

### [ ] C10-07 · Plan the post-pilot waves
- Size: S
- Do: write task files for waves P1–P7 from [dev-plan.md](../dev-plan.md), in the order the
  pilot feedback supports.
