# Architecture

Status: living document. Owner: platform owner (Muhammad Hanzla). Last revised 24 Oct 2026, at the start of the design revamp.

## 1. What we are building

A multi-tenant SaaS for party and event rental businesses. Freedom Fun USA is tenant #1. The functional source of truth is the FreedomFun Odoo 19 build (`freedomfunusa_odoo`). The design handoff (`rental-saas-handoff`, product name "Tentpole" as a placeholder) is the source of truth for the interface.

**Conflict rule:** where the design and the Odoo repo disagree on *behaviour*, the repo wins. The design decides *how it looks and feels*. Every conflict is logged in section 9.

## 2. System shape

```
apps/web      Next.js 16 (App Router, RSC, server actions). Staff app, platform console,
              public pages (register, sign-in, quote page), coach portal (PWA, Phase 4).
              Deployed on Vercel.
apps/worker   graphile-worker on Postgres. Scheduled messages, balance charges, partitions,
              purges. Deployed on Railway.
packages/core Pure TypeScript, no I/O: pricing engine (Odoo parity), money, time, phone,
              settings schemas, theme maths, permissions. Runs in browser and server.
packages/db   Drizzle schema, SQL migrations, RLS, services (the only code that touches SQL).
docs/         This file, plus per-phase notes.
```

Request path: browser → RSC page or server action → `server/context.ts` (who, which org, what role, read-only?) → `@rental/db` service → `withTenant()` transaction → Postgres with row-level security.

## 3. Tenancy and security

- Every business row carries `tenant_id`. Keys are composite `(tenant_id, id)` with composite foreign keys, so a row can never point into another tenant.
- The app connects as `rental_app`, a non-owner role, so RLS always applies. `withTenant()` sets `app.tenant_id` per transaction (transaction-local; safe with pooling).
- Cross-tenant reads (a user's org list, invitation lookup, the platform console) go through `SECURITY DEFINER` SQL functions with narrow signatures. No general "bypass RLS" connection exists in the web app.
- Unknown or foreign ids return **404, never 403** (the existence of another tenant's data is not revealed).
- **Platform owner** = a row in `platform_admins`. Console routes check it on the server; console SQL functions also check it.
- **Read-only modes**, enforced in the one mutation gate (`assertWritable`), not in the UI:
  - org `suspended` (members can sign in and read; scheduled sends and auto-charges pause in the worker);
  - platform **impersonation** (support), audited, red banner, bound to the admin's session.
- Audit: every state change writes `audit_log` (partitioned by month, insert-only for `rental_app`).

## 4. Identity

- better-auth: email + password (min 8), sessions in Postgres, cookie cache 5 min.
- Sign-in is two steps (email → password), matching the design. Passkeys and two-step verification use better-auth plugins (rolled in once platform email is configured; the UI already reserves their place).
- Roles: `owner, admin, manager, sales, coach, crew, accountant, viewer`. Permissions are derived in `@rental/core/permissions` from the matrix in the design (section 06 of Phase 0), plus per-person extra grants.
- After sign-in: platform owner → console; one org → that org; several → picker.

## 5. Data model notes

- Money: integer cents (`bigint`) everywhere. Rounding only where the pricing engine says.
- Time: `timestamptz` UTC. Event times are wall-clock in the **location's** IANA zone.
- **Location = warehouse.** A location is a branch that equipment ships from (user decision, matches Odoo's ship-from). It owns timezone, tax rate, document code, travel rates, service ZIPs, brand pill colour and a pause switch.
- Org settings: identity and brand are columns on `tenants`; everything else is versioned JSON parsed through zod with defaults (`tenantPreferencesSchema`), so new settings never break old rows.
- Brand: accent colour, sidebar style, corners, appearance, heading font, logo variants (main, square icon, on-dark) with editor parameters (zoom, offset, padding, background, shape, rotate). The original upload is stored once; variants are parameters, rendered by CSS/SVG, not re-encoded images.

## 6. Interface architecture

- **Server components by default.** Client components are small islands (forms, drawers, pickers, maps). No client-side data cache library; server actions + `revalidatePath`.
- **Design tokens** from the handoff (`tokens.css`) are the only colours, radii, shadows and easings in the codebase. The tenant's colour replaces `--accent` at runtime via a `<style>` tag computed on the server (`themeCss`). Status colours never change.
- **One component kit** in `apps/web/src/components/ui/`: Button, IconButton, Field/Input/Select/Textarea, Segmented, Toggle, Tabs, Chip, StatusPill, RoleChip, Kpi, Table, Drawer, Modal, Toast, Progress, Ring, Sidebar, Topbar, CommandPalette, EmptyState. Built once, used everywhere.
- **Motion is CSS only** (rise, slide, sheet, pop, shake, toast, blink, halo) with the design's easings. No animation library. Everything is disabled under `prefers-reduced-motion`.
- **Accessibility**: WCAG 2.1 AA. Real buttons, labelled inputs, `role="dialog"` + focus trap + Esc + focus return, `aria-pressed` chips, `role="tablist"` tabs, visible 2 px focus ring.
- **Responsive**: staff app is fluid 1440 → 360 px; the sidebar becomes a slide-in drawer under 1024 px; tables become stacked cards under 640 px. Coach portal is mobile-first (390 × 844).

## 7. Performance budget

| Item | Budget |
|------|--------|
| First-load JS, staff pages | ≤ 130 KB gzip shared + ≤ 40 KB per route |
| Fonts | self-hosted via `next/font` (Bricolage Grotesque, Geist, Geist Mono), latin subset, `display: swap` |
| Mapbox GL (≈ 220 KB) | loaded lazily only on screens with an interactive map; static map images elsewhere |
| Server response (p95, warm) | ≤ 300 ms for list pages on Neon pooled |
| Interaction to next paint | ≤ 200 ms on a mid-range phone |
| Layout shift | 0 on navigation (skeletons match final layout) |

## 8. Delivery

Per phase: build → typecheck + unit + DB tests → browser e2e (puppeteer, desktop 1440 and phone 390) → deploy to staging (Vercel + Neon + Railway) → owner QA → next phase. Commits are small and per milestone.

| Phase | Scope | Done when |
|-------|-------|-----------|
| 0 | Design system, platform console, register, onboarding (6 steps), sign-in, org home, settings (workspace & brand, locations, team & roles) | New org registers → onboards → brands itself → invites team; owner CRUDs orgs from the console; org A can never read org B |
| 1 | Order builder, calendar, customers, products, product edit, inventory | Odoo parity to the cent; overlapping bookings beyond stock refused |
| 2 | Email/SMS automations, template editor, customer quote page, invoices & payments | Quote → sign → deposit → scheduled balance → receipts, zero manual sends, no duplicates |
| 3 | Ops board, order history / cancel / rain check, reports | Full event week on staging, every cancel outcome posts correct money |
| 4 | Leads, coach admin, coach portal | Lead → booked; coach completes an event on a phone, visible live to admin |
| 5 | Odoo migration (last month of data) | Imported and reconciled |
| 6 | Self-serve billing, Stripe Connect, custom domains, API | Org signs up, pays, goes live alone |

## 9. Design vs repo conflict log (repo wins)

| # | Topic | Design says | Repo (Odoo) does | Decision |
|---|-------|-------------|------------------|----------|
| 1 | Pricing maths | Own formula (`pricing-engine.md`), worked example Q-AUS-01043 | Odoo `custom_rental` formulas; our engine matches 150/150 real orders to the cent | Keep the Odoo-parity engine. The design's worked example is sample data. |
| 2 | Warehouses | Several warehouses inside a location | One ship-from per branch; user ruled "location and warehouse is the same thing" | A location *is* the warehouse. The Workspace "Warehouses" tab lists locations' ship-from points. |
| 3 | Order "Completed" | Status flips Booked → Completed when the coach finishes | Order stays `sale`; "Completed" is a portal label computed from checklist fields | Phase 4: keep the order status Booked; show Completed as a computed label (as Odoo). |
| 4 | Coach rating | Over closed events | Average over Booked + Done orders, any progress | Odoo rule. |
| 5 | En Route gate | Enforced on the server | Enforced in the browser only (server check disabled "for testing") | Enforce on the server too (stricter, same behaviour). |
| 6 | Phase 4 auto-save | Arrival auto-saves Phase 4 | Same (`coach_setup_saved = True` on arrival) | Same. |
| 7 | Payment on arrival | "Due $x · the portal takes no payment" | Tick only, no payment | Same. |
| 8 | Order statuses | draft, quote, booked, completed, cancelled, rained_out, rescheduled | draft, sent, sale, done, cancel (+ rain-check flows in custom_rental) | Internal codes follow Odoo; labels follow the design. Rain-check states arrive in Phase 3 with Odoo's semantics. |
| 9 | Onboarding content | 6 steps incl. Email & payments (skippable) and Team | n/a (Odoo has no onboarding) | Follow the design; rental rules stay out of onboarding (also the earlier owner decision). |
| 10 | Setup surface fee | Per rental line × surface fee | `sale_order_line.setup_surface_fee` per line (not × qty) | Same rule: per product line. The order picks one surface; a line may carry its own. |
| 11 | Rain checks & wallet | Credits applied after tax, deposit on "due after credits" | Raincheck = after-tax discount; wallet outstanding applied after the total | One `credits` table (rain_check / wallet / goodwill) applied after tax; deposit and balance computed on what is left. |
| 12 | Coupon | Coupon codes (FALL10 = 10%) | `coupon_discount` amount stored on the order, taken before tax | `coupons` table resolves the code to an amount, still taken before tax and capped at merchandise. |
| 13 | $ discount cap | min(amount, merchandise) | Pre-tax cap = merchandise + extras − coupon | Odoo cap. |
| 14 | Event types / how they heard | Design's lists | Odoo selections | Odoo lists (keeps reports and imports compatible). |
| 15 | Orders list | No "Orders" item in the sidebar | Odoo has the order list | Kept as its own page (Upcoming, Drafts & quotes, Booked unpaid, Past, Cancelled). |
| 16 | Deposit "None" | Deposit chips include None | Zero override falls back to the default % | Explicit `none` deposit kind, so an order can be booked with nothing due up front. |
| 17 | Travel fee | Client shows miles × rate | POS computed travel from the nearest depot | Miles are an input (Mapbox, or typed); the server always recomputes the fee from the depot's rules unless the fee itself is overridden. |
| 18 | Stock tracking | Pooled / Serialized / Not tracked | `rental_quantity` per product, any booking blocks | Pooled (owned − out of service, no row = 1 like Odoo), serialized (units ready/cleaning), not tracked (never runs out); allow overbooking per location. |
| 19 | Message idempotency key | `org:order:type:orderVersion` | `rental.email.log.send_key` unique + 60 s cooldown | `org + key` unique. Instant: per event (`order:quote:v7`, `payment:receipt`). Scheduled: `order:type:channel:dueTime`, so a moved event gets new rows and stale queued ones are cancelled; a rule changed and changed back revives the cancelled row; a sent row is never re-sent. |
| 20 | Reminder timings | Pre-event 3 d, quality text 2 d, day-before 1 d, charge on event day, review +1 d, thank-you +2 d, survey +7 d | Same days (America/Chicago crons) | Same defaults; each editable; computed in each location's time zone instead of a fixed Chicago clock. |
| 21 | When automations run | Live once setup is done | Always on | A new workspace starts with automations **off** (no surprise customer email); staff-pressed sends (Send quote, Email invoice, Resend) always go. |
| 22 | Delivery in development | n/a | n/a | `MESSAGING_DELIVERY=outbox` writes every email/text to `.data/outbox`; `live` sends through the workspace's SMTP / Twilio / Quo. Production defaults to live. |
| 23 | Rental agreement | Versioned agreement + 4 policy ticks on the quote page | Printable contract with "Lessee initial" boxes; fixed Freedom Fun text | Each workspace edits its own agreement and policies (Settings → Workspace & brand → Agreement). A signature stores the exact text, version, typed name, ticks with times, waiver choice, IP and browser; signatures can't be edited or deleted. The demo uses Freedom Fun's Terms of Lease; its initial boxes became policy ticks. |
| 24 | Invoices | Deposit, balance, tip | One sale order, payments against it | Invoices are derived from the order (deposit + balance, or one full invoice when there is no deposit) and re-synced on every change. The balance is due on the event day and auto-charged when a card is saved. |
| 25 | Card gateway | Stripe hosted fields | iPOS Pay | Stripe first (Payment Element; card numbers never touch our servers). Keys are checked against Stripe before saving, and test and live keys can't be mixed. iPOS Pay follows with the same flow once sandbox credentials exist. |
| 26 | Printable documents | PDF attachments | wkhtmltopdf reports | Print pages (invoice, receipt, signed agreement) styled for paper; "Print or save as PDF" uses the browser, so there is no PDF service to run. Emails link to them instead of attaching. |

## 10. Environments and secrets

`.env` at the repo root (never committed). Production secrets live in Vercel / Railway / Neon dashboards. Only `pk.` Mapbox tokens reach the browser. SMTP passwords, SMS keys and gateway keys are encrypted at rest (AES-256-GCM with a key from `APP_ENCRYPTION_KEY`) and never sent back to the browser after saving.
