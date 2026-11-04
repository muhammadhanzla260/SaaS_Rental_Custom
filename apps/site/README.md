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
  Events: `view_events`, `view_cars`, `start_trial`, `join_waitlist`, `book_demo`, `quiz_result`.

## Product videos (/demo)

The demo page plays four videos: the 4-minute tour in three looks (aurora, sunrise, lagoon) and the
full training. The files live in the app's **private** R2 bucket under `site/videos/<id>.mp4`.
`/api/video/<id>` redirects to a signed link that expires after an hour, so the bucket stays
private. Posters are in `public/video/`, and the list is in `src/data/videos.ts`.

To publish or replace them:

```sh
# web copies (index moved to the front so playback starts at once) in <repo>/.data/video/site/
ffmpeg -i .data/video/out/aurora.mp4 -c copy -movflags +faststart .data/video/site/tour-aurora.mp4
# then upload with the app's R2 settings
R2_ENDPOINT=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… node apps/site/scripts/upload-videos.mjs
```

Set the same four `R2_*` variables on the site's Vercel project. Without them (local preview) the
endpoint streams from `.data/video/site/`, or from `VIDEO_LOCAL_DIR`.

## Editing content

| What | Where |
|------|-------|
| The one pricing line ("Start from as small as $20…", shown on E1, C1 and the quiz) | `src/data/plans.ts` (`STARTING_PRICE`) and `src/components/PriceLine.astro` |
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
