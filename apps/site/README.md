# Rent Hatch marketing site (`apps/site`)

The public website at renthatch.com. The product itself lives on app.renthatch.com (`apps/web`).

## Run it

```sh
pnpm install
pnpm site                      # dev server on http://localhost:4321 (shows drafts)
pnpm site:build                # production build
pnpm --filter @rental/site preview   # serve the build on :4321
pnpm --filter @rental/site test      # E2 calculator vs. the pricing engine
```

Locally, form emails are written to `.data/outbox/` at the repo root instead of being sent.

## How it is built

- **Astro, static first.** Every page is prerendered HTML with inlined CSS and self-hosted fonts.
  JavaScript is one shared ~4 KB script plus a small island per interactive page. The only server
  code is `src/pages/api/forms/[kind].ts`.
- **Two businesses, one site.** `src/lib/site.ts` holds the nav, footer and calls to action for
  `events` and `cars`. `Nav` and `Footer` take a `vertical` prop. Vertical pages set the
  `rh_vertical` cookie. Shared pages render both variants, and an inline head script shows the
  right one before first paint. Return visitors to `/` are redirected at the Vercel edge
  (`integrations/vertical-redirect.mjs`). `/?choose=1` always shows the start screen.
- **Real pricing.** The E2 calculator imports `@rental/core/pricing`, the same engine the app uses.
  `src/lib/price-demo.test.ts` checks the $618.11 reference and 10 random inputs.
- **Forms** (newsletter, early access, demo, contact) post to `/api/forms/<kind>`. They work
  without JavaScript, and with it they post in place. Spam protection: a honeypot, a timing check,
  a per-IP rate limit, and Cloudflare Turnstile when its keys are set. Each submission goes to the
  CRM webhook and the team inbox, and the visitor gets a thank-you email. Demo bookings include a
  calendar invite.
- **Tracking** (GA4, Google Ads, Meta Pixel) loads only after cookie consent; see `src/scripts/track.ts`.
  Events: `view_events`, `view_cars`, `start_trial`, `join_waitlist`, `book_demo`, `quiz_result`, `pricing_toggle`.

## Editing content

| What | Where |
|------|-------|
| Plans and prices (home, pricing, quiz, structured data) | `src/data/plans.ts`. Set `PRICES_FINAL = true` once prices are confirmed |
| Feature list | `src/data/features.ts` |
| Integrations | `src/data/integrations.ts` |
| Company facts, emails, sub-processors | `src/data/company.ts` |
| Blog, help, changelog, legal, customer stories, jobs | Markdown in `src/content/<collection>/` |

Drafts (`draft: true`, stories without `approved: true`, jobs without `open: true`) show only in
`pnpm site`, never in production. `/customers` stays `noindex`, out of the sitemap and out of the
footer until a story is approved.

After adding a page, add it to `scripts/og.py` and run `python apps/site/scripts/og.py` to make its
Open Graph card.

## Deploy (Vercel)

Create a second Vercel project from this repo with **Root Directory `apps/site`** (framework: Astro)
and point renthatch.com at it. Environment variables are listed in `.env.example`. At minimum set
`PUBLIC_SITE_URL`, `PUBLIC_APP_URL`, `PLATFORM_SMTP_URL`, `SITE_MAIL_FROM` and `CRM_WEBHOOK_URL`.
Set `NEXT_PUBLIC_SITE_URL` on the app project too, so its sign-up page links back here.
