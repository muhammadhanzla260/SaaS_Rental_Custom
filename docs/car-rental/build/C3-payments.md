# C3 · Payments, webhooks, disputes, ledger, tax invoices (weeks 13–16)

Branch: `cars/phase-c3`. Overlaps the end of C2. Design references:
[architecture.md](../architecture.md) §7, §13.3, [booking-flow.md](../booking-flow.md) §6.4–6.5,
[security.md](../security.md) §3.6.

**Phase exit**
- The AED money lifecycle (hold, part capture, release, refund, no-show fee, post-rental charge)
  reconciles to the minor unit against the gateway sandbox.
- A webhook delivered twice changes nothing the second time.
- A test dispute produces a complete evidence pack.
- An issued invoice cannot be changed.
- Event payment tests and `e2e-payment-options.mjs` pass unchanged.

---

### [ ] C3-01 · `PaymentGateway` port
- Size: M
- Change: `packages/platform/src/payments/contract/`: the interface from `architecture.md` §7.2
  (`capabilities`, `createCustomer`, `tokenizeSession`, `authorize`, `increment`, `capture`,
  `void`, `refund`, `chargeSaved`, `parseWebhook`) and a normalized `PaymentEvent` type. A fake
  in-memory gateway for tests.
- Done when: the fake passes a shared contract test suite that every adapter must pass.

### [ ] C3-02 · Move Stripe behind the port
- Size: L
- Depends on: C3-01
- Change: wrap `packages/payments/src/stripe.ts` as the Stripe adapter. Add `authorize`
  (`capture_method: manual`), `increment`, `capture`, `void` and merchant-initiated charges.
  `packages/payments/src/flows.ts` keeps its behaviour for events and calls the adapter.
- Done when: the adapter passes the contract suite against Stripe test mode; all event payment
  tests pass unchanged.

### [ ] C3-03 · Webhook ingestion
- Size: L
- Depends on: C3-01
- Change:
  - Route `apps/web/src/app/api/webhooks/[provider]/[tenantId]/route.ts`: read the raw body,
    verify the signature and a 5-minute timestamp window with the workspace's webhook secret,
    store the event in `platform.gateway_events` (unique on provider + event id), return 200
    fast.
  - A `critical`-queue job processes stored events through `parseWebhook` into handlers that are
    safe to run twice: payment succeeded or failed, authorization expiring, refund updated,
    dispute opened or closed, payout paid.
  - A replay command for one event or a time range.
  - Settings screen: show the webhook URL and store the signing secret (encrypted, `v2`).
  - Keep `reconcile_payments` as the safety net.
- Done when: tests cover a bad signature (401, nothing stored), a stale timestamp, a duplicate
  event, and replay; a payment finished in a closed browser tab is recorded from the webhook.

### [ ] C3-04 · First GCC gateway adapter
- Size: L
- Blocked by: D1
- Depends on: C3-01, C3-03
- Change: an adapter for the chosen gateway in `packages/platform/src/payments/adapters/`, with
  hosted card fields, 3-D Secure, AED, and its capability flags set from the provider's
  documentation (authorization hold length, incremental authorization, partial capture).
- Done when: the adapter passes the contract suite against the provider sandbox.

### [ ] C3-05 · Car payment options
- Size: L
- Depends on: C2-07, C3-02
- Change: `cars.payments` commands for `pay_now_full`, `pay_now_partial`,
  `pay_at_pickup_guaranteed` (card saved or small authorization) and `cash`, each satisfying
  Gate B as defined in `booking-flow.md` §6.4. Idempotency keys include the reservation version.
- Done when: tests cover each option reaching Confirmed, and a failed payment leaving the hold in
  place until expiry.

### [ ] C3-06 · Cancellation and no-show fees
- Size: M
- Depends on: C3-05
- Change: compute the fee from the locked policy snapshot (pure), charge it on the guaranteed
  card or keep it from what was paid, refund the rest, and notify the customer.
- Done when: tests cover each cancellation tier, a no-show, and a refund split across two
  payments.

### [ ] C3-07 · Deposit strategies
- Size: L
- Blocked by: D4 (default only; the code supports all four)
- Depends on: C3-02
- Change: `cars.deposits` (strategy, amount, state, authorization id, expires at, release due
  at). Strategies: `auth_hold` (with a `critical` job that re-authorizes before expiry and alerts
  on failure), `charge_and_refund` (release due after the configured days, never beyond the
  country cap), `no_deposit` (adds the surcharge line), `none`. Commands: place, capture part,
  release.
- Done when: fake-clock tests cover re-authorization, a failed re-authorization alert, part
  capture then release, and the cap.

### [ ] C3-08 · Ledger
- Size: L
- Change: `platform.ledger_entries` (tenant, order, account, debit or credit, amount, currency,
  reference, at), written in the same transaction as each money event. Accounts: receivable by
  payer, revenue, VAT payable, deposit liability, pass-through payable. A check that entries for
  an order balance. Extend reconciliation to compare ledger totals with gateway totals per day.
- Done when: every money test in this phase also asserts a balanced ledger; a deliberate mismatch
  is reported.

### [ ] C3-09 · Immutable tax invoices and credit notes
- Size: L
- Depends on: C1-10
- Change:
  - For workspaces with `invoices.mode = 'issued'` (the default for cars): an invoice gets its
    number on issue, and a database trigger then refuses updates to its amounts, lines, customer
    and dates. Changes create a credit note or a debit note that references it.
  - Invoice lines stored on issue (not derived on read), with tax components.
  - Bilingual print page (English and Arabic) with TRN and "Tax Invoice", VAT-inclusive display
    for consumers.
  - Events keep today's derived invoices unless the workspace switches mode.
- Done when: an update to an issued invoice fails in the database; a price change after issue
  produces a credit note and a new invoice that net to the right amount.

### [ ] C3-10 · Disputes
- Size: M
- Depends on: C3-03
- Change: `platform.disputes` created from webhooks (amount, reason, due date, status). A command
  that assembles an evidence pack as a PDF-ready page: order, signed agreement, payment and
  3-D Secure result, messages sent, and (when they exist) condition reports and statement lines.
  An office alert on open and before the due date.
- Done when: a sandbox dispute creates a record, an alert, and a pack containing every available
  item.

### [ ] C3-11 · Screens: payments on a reservation, deposits, disputes, webhook settings
- Size: L
- Blocked by: design
- Done when: `e2e-cars-c3.mjs` pays a booking with the sandbox card, places and releases a
  deposit, and shows an issued invoice with a credit note.

### [ ] C3-12 · Phase check
- Size: S
- Do: run the full money suite, the reconciliation check and all event tests; confirm the phase
  exit lines; open the PR.
