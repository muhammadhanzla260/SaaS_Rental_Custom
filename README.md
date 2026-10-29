# Rental Custom

A standalone, multi-tenant SaaS for party and event rental businesses: bookings, inventory, products,
customers, quotes, deposits, invoices, payments and reminder emails. It rebuilds the FreedomFun USA
Odoo system as an independent product. Freedom Fun is the first tenant.

Architecture blueprint (stack, data model, roadmap): https://claude.ai/artifact/Betdr7kQ7JDVFC7bscU8E6

## Status

**Phase 0 (foundation) and Phase 1 (catalog, customers, booking) are done.**

### Phase 0

- Sign up and sign in (email and password).
- Three-step onboarding with a live preview of the organization's own app as it is set up:
  business details and address, brand (logo, colour, light/dark default, corner style),
  and the first location on the map. Ends with a celebration. Booking rules (deposit, waiver,
  travel, surfaces) start from FreedomFun's defaults and are set per order in the order builder.
- **Region is detected, never asked:** country from the business address, time zone from the
  location's map pin (offline lookup), currency and date/distance formats from the country.
  Owners can override them in Business profile.
- **Mapbox** address search (type ahead), interactive map with a draggable pin, and map pictures.
  Needs `NEXT_PUBLIC_MAPBOX_TOKEN`; without it, addresses and coordinates can be typed by hand.
- Settings, for owners and admins:

  | Tab | Contents |
  | --- | --- |
  | Business profile | Name, legal name, contact details, tax ID, address, detected region (with override) |
  | Branding | Logo, a logo for dark backgrounds, brand colour, default light/dark mode, corner style |
  | Locations | Places equipment ships from (branch = warehouse): address and pin, time zone from the pin, phone, tax rate, crew loading notes, one primary |
  | Team | Invite by link, roles, disable access; the last owner is protected |
  | Activity log | Who changed what, and when |

- Each organization gets its own brand theme and gradient. Colours are checked for readable contrast in light and dark mode.
- Motion throughout (page transitions, staggered lists, animated progress, sliding indicators); it switches off when the device asks for reduced motion.
- Tenant isolation is enforced in PostgreSQL with row-level security, not just in application code.

### Phase 1

- **Catalog:** categories, products with staffed / pick-up / drop-off prices, included hours, hourly
  rate, 15-minute overtime blocks, minimum hours, turnaround time, photo, and stock per location.
- **Customers:** search, duplicate warning (email or phone), Mapbox address, order history.
- **Order builder:** customer, event window (multi-day too), event address on the map, products with
  live availability, setup surfaces, damage waiver, travel fee from driving distance, discounts,
  coupon, tax, deposit (30% default). Totals update as you type; the server recomputes them on save.
- **Availability:** booking an order holds its equipment from the event start until return plus
  cleanup. Overlapping bookings beyond stock are refused in the database, under a lock.
- **Order flow:** draft → quote sent → booked → completed, with cancel and reopen; edits are
  version-checked so two people cannot overwrite each other.
- **Calendar** of events and a dashboard with what is coming up.
- **Pricing parity with Odoo,** checked against the 150 most recent FreedomFun orders on staging
  (`pnpm --filter @rental/core parity`, read-only):
  - Order totals: all 150 match to the cent. 145 match Odoo's current rules. The other 5 were saved
    between 12 and 18 Sep 2026, when Odoo briefly took % discounts on merchandise plus fees and put
    $ discounts after tax; they match that rule to the cent, and Odoo keeps their stored totals.
  - Line prices: 308 of 317 match the POS formula. The other 9 are prices staff typed in (including
    $0 comped lines). Odoo treats them as manual overrides, and migration imports them the same way.

**Next: Phase 2.** Quote emails over the tenant's SMTP, the customer quote / sign / pay page, Stripe
deposits, invoices and receipts.

## Stack

| Part | Choice |
| --- | --- |
| Web app | Next.js 16 (App Router), React 19, Tailwind CSS 4, deployed on Vercel |
| Database | PostgreSQL 17 (Supabase in production; an embedded local server for development) |
| Data access | Drizzle ORM, SQL migrations, row-level security |
| Auth | Better Auth (email and password, sessions in our own database) |
| Background jobs | graphile-worker (queue in Postgres), on Railway |
| Language | TypeScript, pnpm workspaces, Turborepo |

```
apps/
  web/        Next.js app: staff app, onboarding, settings (later: customer quote/pay pages, crew app)
  worker/     background jobs (housekeeping now; emails, reminders, auto-charge later)
packages/
  core/       framework-free business rules: pricing engine, settings schemas, theme engine, phones, regions
  db/         Drizzle schema, migrations, tenant-scoped services, integration tests
```

## Run it locally

Requires Node 22+ and pnpm. No Docker needed.

```bash
pnpm install
cp .env.example .env        # then set BETTER_AUTH_SECRET (command is in the file)
pnpm db:start               # local PostgreSQL 17 on port 54329; leave it running
pnpm db:migrate             # in a second terminal
pnpm dev                    # http://localhost:3000
pnpm worker                 # optional: background jobs
```

Open http://localhost:3000, create an account, and the onboarding wizard starts.

## Tests

```bash
pnpm test                   # core unit tests and database integration tests (needs db:start)
pnpm typecheck
pnpm --filter @rental/web build && pnpm --filter @rental/web start
node apps/web/scripts/e2e-onboarding.mjs   # real-browser run of sign-up, onboarding and settings, with screenshots
node apps/web/scripts/e2e-orders.mjs       # real-browser run of catalog, customers, booking and overlap refusal
pnpm --filter @rental/core parity          # read-only pricing comparison with Odoo staging (needs ODOO_ENV_FILE)
```

The database tests connect as the restricted runtime role, the same one the app uses. They prove one
tenant can neither read nor write another tenant's rows.

## How tenant isolation works

- Every tenant-owned table has `tenant_id` and a composite key `(tenant_id, id)`. Foreign keys include
  `tenant_id`, so a row cannot point at another tenant's row.
- The app connects as `rental_app`, which does not own any table, so row-level security always applies to it.
- Each request runs inside `withTenant()`, which sets `app.tenant_id` for that transaction only.
- Queries that must cross tenants ("which organizations do I belong to", "open this invitation link")
  go through two small `SECURITY DEFINER` functions.
- Migrations and the worker use the owner role. Worker code must still scope every query to one tenant.

## Branches and releases

`main` is what is live. Nothing is committed to it directly.

| Branch | What it is | Deploys to |
| --- | --- | --- |
| `main` | The live app. Changes only through a reviewed pull request. | Production: the live URL, the production database and the worker |
| `revamp/phase-0`, `revamp/phase-1`, `revamp/phase-2`, … | One branch per phase. All work for that phase happens here. | A Vercel preview link per push, on the staging database |

- **Start a phase:** branch `revamp/phase-N` from the previous phase's branch (or from `main` once that
  phase is live), and work only there.
- **Go live:** open a pull request from `revamp/phase-N` into `main`, check the preview link, and merge.
  Production updates on its own. A phase branch built on the previous one takes that phase live too.
- **Data stays apart:** previews use the staging database, so testing a phase never touches live bookings
  or charges a real customer.
- `main` is protected on GitHub: pull requests only, no direct pushes.

## Deploying

You create the accounts and add the keys as environment variables. Never commit `.env` or
`.env.production`. Everything runs in the same US East region, so each database query stays fast.

1. **Supabase.** Two projects in East US (North Virginia): `production` and `staging`. For each, put the
   owner connection string in `DATABASE_URL_OWNER` and choose a strong `APP_DB_PASSWORD`. Run
   `pnpm db:migrate` once; it creates the `rental_app` role and sets its password. Then set `DATABASE_URL`
   to the **transaction pooler** connection string with user `rental_app` and that password.
2. **Vercel.** Import the repo, set Root Directory to `apps/web` and the production branch to `main`, and add
   `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_URL`, `APP_ENCRYPTION_KEY` and
   `NEXT_PUBLIC_MAPBOX_TOKEN` (production values for Production, staging values for Preview).
3. **Railway.** New service from the repo on `main`, config file `apps/worker/railway.json`, with
   `DATABASE_URL_OWNER` (the **session pooler** connection, which keeps the job queue's listener working)
   and `DATABASE_URL`.

CI (GitHub Actions) runs migrations, typecheck, tests and the production build against PostgreSQL 17 on every push.
