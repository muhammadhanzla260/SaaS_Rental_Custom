# C4 · Drivers, documents, KYC, media, customer channels (weeks 17–20)

Branch: `cars/phase-c4`. Design references: [booking-flow.md](../booking-flow.md) §1, §4, §6,
[architecture.md](../architecture.md) §13.7–13.8, [channels.md](../channels.md) §2,
[security.md](../security.md) §3.3, §3.5, §3.7.

**Phase exit**
- An unverified or ineligible driver cannot pass hand-over (domain test and database test).
- A web booking → portal completion → ready works on a phone in English and Arabic.
- Every view of an ID document is in the audit trail.
- An ID photo sent in chat is not stored (reference case R6).

---

### [ ] C4-01 · Direct uploads and file purposes
- Size: L
- Change:
  - `packages/db/src/storage.ts`: add presigned PUT and GET URLs (short expiry) to `ObjectStore`.
  - `files.purpose` becomes an enum with an access rule per purpose (`logo`, `product_image`,
    `vehicle_photo`, `condition_photo`, `id_document`, `agreement`, `statement`). Reads of
    `id_document` need the `drivers.view_documents` permission and write an audit row.
  - Upload flow: request an upload slot (size, type and purpose checked) → browser uploads to the
    bucket → confirm (server checks size, type by magic bytes, image dimensions, hash).
  - Jobs: thumbnail generation and malware scan; a file is `pending` until both pass.
  - Replace the any-member check in `apps/web/src/app/api/files/[tenantId]/[fileId]/route.ts`
    with the purpose rule, and redirect to a signed URL instead of streaming.
- Done when: tests cover an oversized file, a wrong type, a view without permission (404), an
  audit row per ID view, and logos still loading publicly.

### [ ] C4-02 · Field-level encryption with a key service
- Size: M
- Depends on: C0-11
- Change: a `KeyService` port with a local implementation (keys from `APP_ENCRYPTION_KEYS`) and
  room for a KMS implementation in the UAE cell (C9). A data key per workspace, wrapped by the
  cell key and cached in memory briefly. Helpers `encryptField` and `hashForSearch`.
- Done when: tests cover two workspaces unable to read each other's ciphertext, and rotation of
  the wrapping key without re-encrypting fields.

### [ ] C4-03 · Driver profiles and identity documents
- Size: L
- Depends on: C4-01, C4-02
- Change: `cars.driver_profiles` and `cars.identity_documents` as in `booking-flow.md` §1 and §9:
  encrypted numbers plus search hash, issuer, dates, licence classes, script, files, verification
  state (`declared`, `auto_verified`, `manually_verified`, `rejected`) with method, who and when.
  A document type catalog as data, with the UAE types. A purge job that deletes ID files and
  numbers after the retention period, unless a legal hold is set.
- Done when: tests cover reuse of a verified document across bookings, expiry against the return
  date plus buffer, the purge, and tenant isolation.

### [ ] C4-04 · Declared and verified facts in the gates
- Size: M
- Depends on: C4-03, C2-06
- Change: build the rules-engine fact model from driver profiles with a `source` per fact. Gate C
  evaluates with verified facts only. Replace the C2 stub. A database check refuses opening an
  agreement while any driver on it lacks a verified licence and ID.
- Done when: a booking made with a typed age of 30 and a document showing 23 re-evaluates the
  young-driver rules at hand-over.

### [ ] C4-05 · KYC vendor adapter and scan prefill
- Size: L
- Blocked by: D5
- Change: a `KycProvider` port (start a check, receive the result by webhook through the C3
  ingestion path, fetch extracted fields) and one adapter. Extracted fields prefill the form as
  proposals that a person or the vendor result confirms. A manual verification screen for staff,
  behind a permission.
- Done when: a sandbox check moves a document to `auto_verified`; a failed check never does; a
  mismatch between typed and extracted fields is flagged.

### [ ] C4-06 · Rental agreement
- Size: L
- Change: `cars.agreement_templates` (versioned, English and Arabic, with policy blocks) edited
  in Settings. Signing reuses the `signatures` pattern (exact text, version, typed name, IP,
  user agent, time), adds consent for post-rental charges, and records which drivers signed. A
  print page.
- Done when: a signed agreement cannot be edited or deleted; a template change does not alter
  signed copies.

### [ ] C4-07 · Customer portal: complete your booking
- Size: L
- Blocked by: design
- Depends on: C4-03, C4-06
- Change: a public page by single-purpose expiring token (pattern: `apps/web/src/app/q/[token]`)
  showing the readiness checklist: upload documents, add drivers, sign, pay, see charges. Rate
  limits per token and per IP. `noindex`.
- Done when: `e2e-cars-c4.mjs` completes a booking on a 390 px screen in English and Arabic.

### [ ] C4-08 · Booking widget
- Size: L
- Blocked by: design
- Depends on: C2-05
- Change: a public booking flow of at most four screens (search, choose, extras and driver
  basics, pay). Availability calls require a short-lived signed token issued with the page and
  are rate-limited. Turnstile on the final step. Eligibility pre-check from declared facts.
- Done when: a booking can be made without signing in; a scripted loop on the availability
  endpoint is limited; a bot without the page token is refused.

### [ ] C4-09 · Two-way messaging
- Size: L
- Change: `conversations` and inbound `messages` rows; provider webhooks (through the C3
  ingestion pattern) for inbound texts, delivery status and opt-out replies; opt-outs update the
  customer's consent and stop further sends on that channel.
- Done when: an inbound "STOP" blocks later texts; a delivery failure shows on the message.

### [ ] C4-10 · WhatsApp inbox, staffed by people
- Size: L
- Blocked by: design; a WhatsApp Business account (ops)
- Depends on: C4-09, C2-10
- Change: a WhatsApp Cloud API adapter (send template and session messages, receive webhooks,
  enforce the 24-hour window and opt-in). An inbox screen with assignment, live updates, quick
  actions that send a quote, a payment link or a secure upload link. **Media that looks like an
  ID document is not saved**: the message is stored without the attachment and the customer gets
  the upload link.
- Done when: reference case R6 passes; two staff see the same conversation update live; a message
  outside the 24-hour window is sent only as an approved template.

### [ ] C4-11 · Limits before one-time codes, and egress control
- Size: M
- Blocked by: Redis being provisioned (ops)
- Change: Redis-backed limits per user, workspace, IP and phone number; a Turnstile check and
  per-phone, per-IP and per-country limits before any SMS or WhatsApp code is sent. An outbound
  fetch helper that resolves the host, refuses private and internal ranges, and is used for
  tenant-entered addresses (SMTP hosts, calendar feeds, webhooks).
- Done when: tests cover the limits and a refused request to `169.254.169.254` and to
  `localhost`.

### [ ] C4-12 · Reminders until ready
- Size: M
- Depends on: C4-07, C4-09
- Change: message templates and scheduled messages that chase missing checklist items until the
  booking is ready or picked up, respecting quiet hours and consent. Same idempotency scheme as
  event automations.
- Done when: fake-clock tests show reminders stop the moment the booking is ready.

### [ ] C4-13 · Phase check
- Size: S
- Do: confirm the phase exit lines; run all event tests; open the PR.
