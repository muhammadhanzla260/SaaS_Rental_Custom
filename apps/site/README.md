# Rent Hatch marketing site (`apps/site`)

The public website at renthatch.org. The product itself lives on app.renthatch.org (`apps/web`).

## Run it

```sh
pnpm install
pnpm site                      # dev server on http://localhost:4321 (shows drafts)
pnpm site:build                # production build
pnpm --filter @rental/site preview   # serve the build on :4321 (forms need PHP, so they only work once uploaded)
pnpm --filter @rental/site test      # E2 calculator vs. the pricing engine
```


## How it is built

- **Astro, fully static.** Every page is prebuilt HTML with inlined CSS and self-hosted fonts, so it
  runs on any web host. JavaScript is one shared ~4 KB script plus a small island per interactive
  page. The only server code is `public/api/form.php` (PHP, for the forms).
- **Two businesses, one site.** `src/lib/site.ts` holds the nav, footer and calls to action for
  `events` and `cars`. `Nav` and `Footer` take a `vertical` prop. Vertical pages set the
  `rh_vertical` cookie. Shared pages render both variants, and an inline head script shows the
  right one before first paint. Return visitors to `/` are redirected by Apache
  (`public/.htaccess`). `/?choose=1` always shows the start screen.
- **Real pricing.** The E2 calculator imports `@rental/core/pricing`, the same engine the app uses.
  `src/lib/price-demo.test.ts` checks the $618.11 reference and 10 random inputs.
- **Forms** (newsletter, early access, demo, contact) post to `/api/form.php?kind=<kind>`. They work
  without JavaScript, and with it they post in place. Spam protection: a honeypot, a timing check,
  a per-IP rate limit, and Cloudflare Turnstile when its keys are set. Every lead is emailed to
  `lead_email` in `public/api/config.php`, and the visitor gets a thank-you email. Demo bookings
  include a calendar invite.
- **Tracking** (GA4, Google Ads, Meta Pixel) loads only after cookie consent; see `src/scripts/track.ts`.
  Events: `view_events`, `view_cars`, `start_trial`, `join_waitlist`, `book_demo`, `quiz_result`.

## Product videos (/demo)

The demo page plays four videos: the 4-minute tour in three looks (aurora, sunrise, lagoon) and the
full training. They are plain files in `public/video/<id>.mp4` (git-ignored because of their size,
about 265 MB) next to their posters, and ship with the build. The list is in `src/data/videos.ts`.
To recreate them from the recordings, with the index moved to the front so playback starts at once:

```sh
ffmpeg -i .data/video/out/aurora.mp4 -c copy -movflags +faststart apps/site/public/video/tour-aurora.mp4
```

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

## Deploy (Namecheap shared hosting)

1. Copy `.env.example` to `.env` and check `PUBLIC_APP_URL` (the product app on Vercel).
2. `pnpm site:build`. Everything to upload is in `apps/site/dist/`, including `.htaccess`, `api/` and `video/`.
3. Upload the **contents** of `dist/` into `public_html/` (cPanel File Manager: upload a zip and
   extract it, or FTP). Show hidden files so `.htaccess` goes too.
4. In cPanel, create the mailbox `hello@renthatch.org` (the sender in `public/api/config.php`), and
   turn on SSL for the domain.

Lead emails go to `lead_email` in `api/config.php`; change it there on the server any time.
