# C9 · UAE cell, central login store, e-invoicing (weeks 10–24, parallel)

Branch: `cars/uae-cell`. Design references: [architecture.md](../architecture.md) §8,
[security.md](../security.md) §3.1, §3.7.

Most tasks here are infrastructure and need D2 (hosting) first. The cell must be live by week 24,
before the field app is tested in Dubai.

**Track exit**
- A Dubai workspace's database, files, backups and logs stay in the UAE cell.
- p95 page response from Dubai ≤ 300 ms.
- One login works for a US workspace and a UAE workspace.
- A restore drill in the UAE cell meets the recovery targets.

---

### [ ] C9-01 · Choose hosting and write the cell as code
- Size: L
- Blocked by: D2
- Do: infrastructure-as-code for the UAE cell: a load balancer over at least two app instances
  in two zones with health checks and auto-scaling, PostgreSQL 17 with a standby and a read
  replica, a connection pooler, Redis, an object bucket, a KMS key, the worker and ingest
  services, private networking for the database, backups with point-in-time recovery.
- Done when: the stack can be created and destroyed from code in a scratch account.

### [ ] C9-02 · Make the app cell-aware
- Size: L
- Change: configuration for `CELL_ID`, region-specific buckets, keys and endpoints. Remove
  assumptions of a single deployment (hard-coded URLs, the single R2 bucket, the single backup
  workflow). `tenants.home_cell`. The KMS `KeyService` implementation (C4-02).
- Done when: the same build runs in both cells from configuration only.

### [ ] C9-03 · Workspace directory and routing
- Size: L
- Depends on: C9-02
- Change: a small control-plane table mapping workspace address → cell (no personal data), a
  signed and cached lookup at the edge, and routing of `/[tenant]` requests to the right cell.
  Sign-up asks the country and creates the workspace in the matching cell. The platform console
  lists workspaces across cells.
- Done when: a UAE workspace address opened from the US cell's host lands on the UAE cell with
  no data fetched in the US.

### [ ] C9-04 · Central login store
- Size: L
- Depends on: C0-09, C9-03
- Change: the login tables (`users`, `sessions`, `accounts`, `verifications`, MFA tables) live in
  one central database reached through the `rental_auth` connection. Each cell validates a
  session by a short-lived signed token issued by the central service and cached briefly, and
  keeps only the user id and display name it needs for memberships. The central store runs with
  a standby. Sign-in, sign-out everywhere and MFA work from either cell.
- Done when: one account signs in once and opens a workspace in each cell; revoking the session
  centrally ends access in both within the cache time; a cell cannot read password hashes.

### [ ] C9-05 · Releases and migrations per cell
- Size: M
- Depends on: C9-02
- Change: the pipeline applies migrations and deploys in order: staging → one cell → the other,
  with a stop on failure. Nightly backup and restore-drill workflows per cell, stored in-region.
- Done when: a release rolls through both cells from one pipeline run.

### [ ] C9-06 · Residency review and vendor register
- Size: M
- Blocked by: D3
- Do: legal review of UAE PDPL transfer rules for the central login store and for every outside
  service used by the UAE cell (mail, SMS, WhatsApp, KYC, AI, error tracking). Record the result
  in the vendor register and the privacy terms. Scrub or regionalize anything that fails.

### [ ] C9-07 · UAE e-invoicing adapter
- Size: L
- Blocked by: choice of accredited service provider (ops)
- Depends on: C3-09
- Change: an `EInvoiceProvider` port fed by `InvoiceIssued` and `CreditNoteIssued` events, and an
  adapter that sends PINT AE (UBL 2.1) documents through the provider, stores the status and
  reference on the invoice, and retries through the outbox.
- Done when: the provider sandbox accepts a test invoice and a credit note.

### [ ] C9-08 · Latency and failover checks
- Size: M
- Do: measure page and API latency from Dubai; fail over the database standby and an app
  instance in a drill; record the results.

### [ ] C9-09 · Track check
- Size: S
- Do: confirm the track exit lines; move the pilot workspace to the UAE cell.
