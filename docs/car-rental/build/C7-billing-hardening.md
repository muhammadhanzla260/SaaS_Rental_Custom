# C7 · SaaS billing, security hardening, pilot readiness (weeks 29–31)

Branch: `cars/phase-c7`. Design references: [architecture.md](../architecture.md) §13.4, §13.16,
[security.md](../security.md) §4.

**Phase exit**
- A workspace over a plan limit is stopped in one place with a clear message.
- A restore from backup meets the recovery targets.
- No open high-severity penetration-test finding.
- The pilot operator's fleet, presets and staff are set up in test mode.

---

### [ ] C7-01 · Entitlements
- Size: M
- Change: `packages/platform/src/billing/`: plans as data (features and limits), and
  `entitled(tenant, feature)` / `withinLimit(tenant, meter)` used by commands, screens and agent
  tools. Replace the unused `tenants.plan` labels with plan ids. The platform console edits a
  workspace's plan and overrides.
- Done when: a command for a feature outside the plan returns a typed "not in plan" error; tests
  cover an override.

### [ ] C7-02 · Usage metering
- Size: M
- Depends on: C7-01
- Change: outbox subscribers write `platform.usage_events` (tenant, meter, quantity, at, ref) for
  active vehicles (daily count), bookings, messages by channel, ID checks, agent runs and
  e-invoices. Daily roll-ups. Each event is unique by its source reference.
- Done when: replaying the outbox does not double-count.

### [ ] C7-03 · Subscriptions and invoices for Rent Hatch itself
- Size: L
- Blocked by: D12
- Depends on: C7-02
- Change: a platform-level billing integration (Stripe Billing on the platform's own account):
  subscription per workspace priced per active vehicle, trial, invoices with the right tax,
  failed-payment handling that moves the workspace to `past_due` and then to the existing
  read-only `suspended` mode. A billing page for owners.
- Done when: a sandbox workspace goes trial → active → past due → suspended → active.

### [ ] C7-04 · Prepaid usage balances
- Size: M
- Depends on: C7-02
- Change: a balance per workspace for pass-through costs (WhatsApp, SMS, ID checks, AI), top-up
  by card, low-balance alerts, and a hard stop per meter when the balance is empty (configurable
  grace). Agent budgets read this balance.
- Done when: an empty balance stops new agent runs and paid messages but never stops payment or
  safety messages.

### [ ] C7-05 · Privacy operations
- Size: L
- Change: each context implements `exportSubject(partyId)` and `eraseSubject(partyId)`; a privacy
  job runs them all, honours legal holds, keeps what tax law requires, and records the outcome.
  A vendor register page in the console.
- Done when: an export contains data from every context; an erase removes or anonymizes
  everything not under a hold, verified by a test that searches every table for the subject.

### [ ] C7-06 · Remaining pre-pilot security items
- Size: L
- Change: step-up confirmation on exports, ID views and bank or gateway changes; session list
  and sign-out everywhere; breached-password check on set and change; security notice emails;
  `/.well-known/security.txt`; alerts on mass exports, new API keys and changed payout details.
- Done when: each item has a test or a recorded manual check.

### [ ] C7-07 · Restore drill and incident plan
- Size: M
- Blocked by: D16
- Do: restore the latest backup of each cell into a scratch environment, time it, compare with
  the targets, and fix gaps. Write `docs/runbooks/incident.md` (who is on call, containment,
  customer notice, notification deadlines per country marked "verify").

### [ ] C7-08 · Penetration test and fixes
- Size: L
- Do: commission an independent test of the app, portal, field app, API and both cells. Fix
  high and medium findings. Re-test.

### [ ] C7-09 · Pilot onboarding
- Size: M
- Blocked by: D7
- Do: import the operator's fleet, tune the Dubai preset to their terms, load document lists
  (D6), connect their gateway, WhatsApp number and mail, train staff in test mode, and agree the
  pilot success metrics from [dev-plan.md](../dev-plan.md).

### [ ] C7-10 · Phase check
- Size: S
- Do: confirm the phase exit lines; open the PR; switch the pilot workspace out of test mode on
  the agreed date.
