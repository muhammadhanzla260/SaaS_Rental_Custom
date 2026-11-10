# Channel hub: Meta, marketplaces, brokers, P2P platforms, Google

Status: proposal, for review. Written 10 Nov 2026.
Related: [booking-flow.md](./booking-flow.md) (one booking engine for all channels) and
[architecture.md](./architecture.md) (contexts, adapters, outbox).

**Goal:** a tenant can connect the channels their customers actually use, and configure for each
channel which cars, at what price, under which rules, with how many cars, and who owns the customer
conversation. Every booking from every channel lands in the **same reservation engine**, with the
same availability, rules, money and audit.

---

## 1. Channel types and what each can do

| Type | Examples | How bookings arrive | What we can sync | Research notes |
| --- | --- | --- | --- | --- |
| **Messaging & social (Meta)** | WhatsApp Business Platform, Instagram DMs, Facebook Messenger, click-to-WhatsApp ads from FB/IG | Conversations, handled by staff or the reservation agent in one inbox | Templates, **WhatsApp Flows** (in-chat forms: dates, branch, class), catalog messages (vehicle list), payment **links**, Conversions API events | Dubai operators commonly sell on Instagram and close on WhatsApp. Flows and catalog messages exist on the Cloud API. Click-to-WhatsApp ads need Business Manager, a linked number and a page. Check details against Meta's developer docs |
| **Lead and listing marketplaces** | OneClickDrive (UAE + GCC) | **Leads** by call, WhatsApp or email; the booking is made with the supplier | Listings (vehicles, prices, photos) where possible; lead capture into our inbox; call/WhatsApp attribution | Fixed monthly subscription, no commission; suppliers manage listings in a CMS; customers contact suppliers directly |
| **Brokers / aggregators (B2C)** | Rentalcars.com (Booking Holdings), Discover Cars, EconomyBookings, VIPCars, QEEQ, Expedia/Kayak via aggregators | A **voucher booking** (prepaid to the broker, or pay at desk), by API, email or extranet | Availability and rates (live **pull** by the aggregator, or **push**), bookings, changes, cancellations | The rental contract is with the supplier. Deposit and excess are the supplier's |
| **B2B distribution** | CarTrawler (powers airline and travel-brand car rental) | Live query of availability and rates, then booking | **OpenTravel (OTA) XML**: `OTA_VehAvailRate`, `OTA_VehRateRule`, `OTA_VehRes`, modify, cancel | CarTrawler documents OTA 2009A messages and works with 2,200+ suppliers |
| **P2P platforms (US)** | Turo, Getaround | Platform booking; payout from the platform | **No official public host API found.** Hosts sync by **iCal** and **booking-email parsing** | Current fleet tools (Levy, FleetWire, VEVS) all work this way |
| **Search** | Google Business Profile (per branch), Google Ads | Clicks to our booking widget | Booking link per branch; schema.org structured data on booking pages | Google's vehicle ads are for **cars for sale**, not rentals, so rentals use the Business Profile, normal ads and landing pages |
| **Partners** | Hotels, concierges, travel agents, insurers, corporates | Partner portal or link ([service-modes.md §4](./service-modes.md#4-access-model-change-partner-memberships)) | Commission statements | Hotel and concierge referral is common in Dubai |
| **Own channels** | Website widget, customer portal, QR codes, counter, phone | Direct | — | — |
| **GDS** (later) | Sabre, Amadeus, Travelport | Corporate travel bookings | Heavy certification | Not before GA |

---

## 2. Architecture

```
          ┌───────────────────────── Channel Hub (platform context: distribution) ──────────────────────────┐
inbound → │ apps/ingest: webhooks · OTA XML endpoint · email parser · iCal poller · Meta webhooks            │
          │      ↓ normalize (adapter) → idempotent upsert (channel_booking_id unique) → reservation commands │
outbound ←│ outbox events (AvailabilityChanged, RatesChanged, ReservationChanged) → adapter push (throttled) │
          │ reconciliation job (daily) · conflict queue · per-channel health & kill switch                    │
          └───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**One adapter per channel** (`adapters/chan-*`), as an anti-corruption layer. Each adapter declares
its **capabilities**, and the Settings screen shows only what that channel can do:

```ts
type ChannelCapabilities = {
  content: 'push' | 'feed' | 'none';            // vehicles/classes, photos, descriptions, locations
  availability: 'pull_live' | 'push' | 'ical_export' | 'none';
  rates: 'pull_live' | 'push' | 'none';
  bookings: 'api' | 'webhook' | 'email' | 'ical' | 'manual';
  modify: boolean; cancel: boolean;
  messaging: boolean;                            // Meta: conversations in our inbox
  leads: boolean;                                // marketplaces, Meta lead ads
  payments: 'channel_collects' | 'we_collect' | 'mixed';
  conversions: boolean;                          // Meta Conversions API, Google Ads offline conversions
  payouts: 'statement_import' | 'api' | 'none';  // reconcile what the channel paid us
};
```

**Rules for reliability:**
- Every inbound booking has a **unique key per channel**, so a booking sent twice is created once.
- Outbound pushes go through the **outbox** with retries and backoff. Availability pushes are
  **throttled and coalesced** per class and day.
- **Live-pull** channels (OTA XML) are answered from the `class_availability` projection
  (≤ 400 ms). The booking request is then checked authoritatively under the lock.
- An **allotment + safety buffer** per channel means a push channel's delay can't oversell. If one
  slips through, it goes to the **conflict queue**. The upgrade ladder or the fleet agent proposes a
  fix, and a person decides.
- A **daily reconciliation** compares channel bookings and payouts with ours.
- **Health per channel:** last sync, error rate, alerts. A kill switch per channel stops sync without
  losing data.

**Meta specifics:**
- WhatsApp, Instagram and Messenger conversations land in **one inbox** (the messaging context).
  Staff and the reservation agent both work there, with **hand-off to a person** at any point (a
  setting).
- The 24-hour service window, template approval and opt-in records are enforced by the messaging
  module.
- **ID documents are never accepted in chat** (owner decision, 10 Nov 2026). This is a platform
  guardrail and is not configurable:
  - if a customer sends a photo that looks like an ID, the bot replies with the **secure upload
    link** in the portal;
  - the image is not attached to the customer record, and it is purged under the chat retention
    rule.
- Payments are made with **payment links** to our checkout.
- Booking events (`Lead`, `InitiateCheckout`, `Purchase`) go to the **Conversions API** with the
  tenant's pixel. This respects the consent rules the marketing site already follows.

---

## 3. Configuration per tenant × channel (everything configurable)

| Group | Settings |
| --- | --- |
| Scope | Enabled branches; classes, models or vehicles listed (mapped to the channel's categories, e.g. ACRISS); service modes offered (self-drive, chauffeur, transfer) |
| Content | Title, description, photos and language per channel (falls back to ours); feature tags |
| Rates | Same as direct · ± % markup/markdown · a dedicated rate plan · **net rate** for brokers; rate-parity guard (warn or block if a channel undercuts direct) |
| Inventory | **Allotment** per class, day and channel; safety buffer; stop-sell; close-out dates; minimum lead time; minimum and maximum length of rental |
| Policies | Cancellation (channel's own, imported, or ours); deposit at desk; payment model (prepaid to channel / pay at desk / mixed); required documents; age rules (always within the jurisdiction pack) |
| Acceptance | Auto-confirm · request-to-book (accept within N minutes, else auto-decline) · auto-decline rules (e.g. under 25 on luxury) |
| Money | Commission % or net; who invoices whom; payout statement import and matching; broker receivable in the ledger |
| Customer ownership | Marketing allowed for this channel's customers (off by default for brokers); which messages we send vs the channel |
| Messaging (Meta) | Bot on/off per hour and branch; hand-off rules; templates per language; quiet hours |
| Tracking | UTM, pixel/CAPI per tenant, offline conversions |
| Operations | Sync frequency, alert recipients, kill switch |

Presets per channel type (e.g. "Broker, prepaid, net rate, 2 cars per class per day") get a tenant
live in minutes. Everything stays editable.

---

## 4. Build order (by pilot value)

1. **Meta messaging** (WhatsApp first, then Instagram and Messenger): unified inbox, templates,
   Flows for search and quote, payment links, secure upload links, CAPI events. *Critical for GCC.*
2. **Lead marketplaces and P2P:** OneClickDrive lead capture (email/WhatsApp attribution), plus
   Turo/Getaround **iCal import/export + booking-email parsing**. *Quick, and high value for US
   hosts.*
3. **OTA XML supplier endpoint** (generic OpenTravel `VehAvailRate`/`VehRes`/modify/cancel), then
   certify with **one** aggregator or broker the pilots already use.
4. **Google:** Business Profile booking links per branch, schema.org on booking pages, offline
   conversions.
5. **GDS:** after GA, only if corporate demand appears.

Each connector is its own adapter package with contract tests and a sandbox replay suite (recorded
real payloads), so adding the next one is routine work.
