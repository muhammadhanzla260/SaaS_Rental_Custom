# Security architecture: what a secure Rent Hatch needs

Status: recommendation, for review. Written 12 Nov 2026.
Scope: the whole product (events and cars), the app (`app.renthatch.org`), the marketing site
(`renthatch.org`), the public API, and the planned UAE region.
Related: [architecture-review.md](./architecture-review.md) (findings W1–W17) and
[dev-plan.md](./dev-plan.md) (when each control lands).

Items marked **(verify)** need checking against the provider or the regulator.

---

## 1. Where the product stands today

| Already in place | Missing |
| --- | --- |
| Tenant isolation in the database (row-level security as a non-owner role) | A web application firewall and rate limits in front of the app |
| Sign-in never reveals whether an account exists | MFA, passkeys, SSO |
| Better Auth rate limit (30 requests per 60 s on auth routes) | Rate limits on everything else (quote page, server actions, files) |
| Clickjacking headers, `nosniff`, referrer and permissions policies | A full Content-Security-Policy and HSTS |
| Card numbers never reach our servers (Stripe Payment Element) | Payment webhooks with signature checks |
| Secrets encrypted at rest (AES-256-GCM) | Key rotation, a KMS, keys per workspace |
| Quote links stored as hashes, pages marked `noindex` | Bot protection on public pages of the app |
| Uploaded files served with a sandbox policy | Malware scanning, access rules per file type |
| Turnstile, honeypot and rate limit on marketing-site forms | The same on app sign-up, sign-in, reset and booking |
| Read-only, audited support sessions | Database statement timeouts, error tracking, alerting |
| Nightly backups | Tested restores, recovery targets |

---

## 2. The request-flood case, step by step

**The question:** someone points a loop at a page that does not exist, e.g. `renthatch.org/access`,
and sends requests without end. Does the processor choke and block everyone else?

**What happens today.**
- `renthatch.org` is a static site on shared hosting (Apache with PHP forms). A flood there can
  exhaust the host, because nothing sits in front of it.
- `app.renthatch.org` runs on Vercel functions, which scale out, so one processor does not choke.
  The risks are different:
  - every unknown path such as `/access` is treated as a workspace address, so a signed-in attacker
    causes a database lookup per request;
  - the database allows a fixed number of connections (10 per function instance today), so a flood
    can use them up and real users wait;
  - the bill grows with every request.

**The fix is layered. No single control is enough.**

| Layer | Control | Effect on the flood |
| --- | --- | --- |
| 1. Edge network | Put a CDN and firewall in front of both sites (Cloudflare, or Vercel Firewall for the app). Always-on DDoS protection | Volumetric floods are absorbed before they reach us |
| 2. Edge rate limit | Limit requests per IP address and per network, e.g. 100 per minute for pages and 20 per minute for unknown paths. Repeat offenders get a challenge, then a block | The loop is cut off after the first few seconds |
| 3. Cached "not found" | Serve 404 pages from the edge cache. Check the path against the workspace-address pattern and the reserved list before any database call. Remember "no such workspace" answers for 60 s | A request for `/access` costs almost nothing |
| 4. Bot challenge | Turnstile on forms; a managed challenge for traffic that looks automated | Scripts fail the challenge; people do not see it |
| 5. App limits | Limits per signed-in user, per workspace and per API key, counted in Redis. Request body size caps. A timeout on every request | A single account or key cannot starve the others |
| 6. Database limits | `statement_timeout`, `idle_in_transaction_session_timeout`, a connection pooler with a queue limit, a read replica for heavy reads | A slow or abusive query is killed, not queued forever |
| 7. Work isolation | Separate job queues by priority, one job per workspace, concurrency caps per workspace | A flood of imports cannot delay payments |
| 8. Shed load | When limits are hit, return `429 Too Many Requests` with `Retry-After`. Circuit breakers on outside services | The system degrades in a controlled way |
| 9. Cost guard | Spend alerts and caps on hosting, SMS, WhatsApp, ID checks and AI | An attack cannot become an unbounded bill |
| 10. Detect | Dashboards and alerts on request rate, 4xx/5xx rate, pool saturation, queue depth | We know within minutes |

---

## 3. Recommended controls

### 3.1 Edge and network

- **CDN + WAF in front of everything.** Managed rules for the OWASP Top 10, rules for known bad
  bots, country and network blocking when under attack.
- **Load balancing.**
  - US region: Vercel already balances and scales the app. The worker on Railway should run at
    least two instances.
  - UAE region: a load balancer in front of at least two app instances in two availability zones,
    with health checks and auto-scaling. Database with a standby and automatic failover.
- **TLS everywhere**, HSTS with preload, TLS 1.2 or newer only.
- **The database is never on the public internet.** Private networking or a strict IP allow-list.
  Separate credentials for the app role, the owner role and people.
- **Outbound traffic control (SSRF protection).** The app connects to addresses that businesses
  type in: mail servers, calendar feeds, webhooks. Resolve and check every address, refuse private
  and internal ranges, and route those calls through an egress proxy with an allow-list.

### 3.2 Redis: what it is for

Use a managed Redis in each region (it must work from serverless functions). It holds short-lived
data only. Nothing in it is a system of record.

| Use | Why |
| --- | --- |
| Rate-limit counters | Fast, shared across all app instances |
| Cache | Availability, resolved settings, "no such workspace" answers, sessions |
| Idempotency keys | A repeated request returns the first answer |
| Short locks and one-time codes | OTP attempts, de-duplication of webhooks |
| Live-update fan-out | Publish/subscribe for the fleet calendar, dispatch and inbox |

Every cache key includes the workspace id, so one business can never read another's cached data.

### 3.3 Bots, crawlers and scrapers

- **Turnstile** (already used on the marketing site; reCAPTCHA is an equivalent) on sign-up,
  password reset, the booking widget's final step, quote-page actions and contact forms. On
  sign-in, show it after failed attempts.
- **Before any SMS or WhatsApp code is sent:** a challenge plus limits per phone number, per IP and
  per country. This blocks "SMS pumping", where attackers trigger paid messages for profit.
- **Crawlers.**
  - `robots.txt` and `noindex` on the app, the portals and every tokenised page.
  - Good search crawlers are allowed on booking websites, which need to rank.
  - A stated policy for AI crawlers.
- **Price scraping.** Competitors and brokers will scrape rates from the booking widget. Rate-limit
  availability queries per IP and per session, and require a short-lived signed token from the
  page.
- **Credential stuffing.** Limits per account and per IP, a check of new passwords against known
  breached passwords, and alerts on sign-in from a new country or device.

### 3.4 Accounts and phishing

- **MFA** for every staff role that can move money, see ID documents, change payment or mail
  settings, or manage people. **Passkeys** are preferred because they resist phishing.
- **Platform admins:** passkeys or hardware keys only, short sessions, and access granted for a
  limited time.
- **Step-up confirmation** for refunds, exports, viewing ID documents, and changing gateway keys or
  bank details.
- **Session safety:** a device list, sign-out everywhere, sessions ended on password change, cookies
  `Secure`, `HttpOnly`, `SameSite`.
- **Email authenticity:** SPF, DKIM and DMARC at `p=reject` for `renthatch.org`. Businesses that
  send from their own domain must verify it.
- **Links customers can trust:** payment, upload and signing links only on our domain or a
  business's verified domain. Tokens are single-purpose and expire.
- **Stop the platform being used for phishing.** New workspaces get sending limits. Outgoing
  templates are scanned for known bad links. There is an abuse-report address and a quick
  suspension path (the suspend switch exists).
- **Lookalike workspaces.** Extend the reserved address list and check new names against known
  brands.
- **Staff awareness:** security notices by email for new sign-ins, changed bank details and new
  API keys.

### 3.5 Application security

- **A full Content-Security-Policy** with nonces, replacing today's frame-only policy. Add
  `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`.
- **Input rules:** every input parsed by a strict schema (already the pattern), with length caps,
  and no regular expressions that can run away on crafted input.
- **Uploads:** direct to the bucket with a signed URL, size and type limits, image dimension caps
  (to stop decompression bombs), malware scanning, and stripped metadata where it is not evidence.
- **Cross-site request forgery:** server actions check the origin. Any new API route that uses
  cookies needs the same check.
- **Authorisation in the database:** the CI check that every table declares its tenant, location
  and partner rules (review item G9).
- **Errors:** friendly messages to users (already), full detail to the error tracker with personal
  data removed.
- **Dependencies and build:**
  - automated dependency updates and vulnerability alerts;
  - static analysis and secret scanning on every pull request;
  - install scripts stay blocked except the allow-list (already);
  - CI actions pinned to exact versions;
  - branch protection and required reviews (already for `main`).

### 3.6 API security

Follows the OWASP API Security Top 10.

| Risk | Control |
| --- | --- |
| Reading another business's or customer's object | Row-level security plus tenant, location and partner scopes; ids are never trusted alone |
| Weak authentication | OAuth 2 with scopes for apps; API keys that are hashed, scoped, expiring and rotatable; no keys in URLs |
| Too much data returned, or fields set that should not be | Response and request schemas from the contracts; unknown fields rejected |
| Unlimited use | Quotas per key and per workspace; page size caps; request size caps; timeouts |
| Function-level access | The same permission check as the staff app, from the command's contract |
| Abuse of business flows | Limits on holds per customer, bookings per card, OTPs per phone; risk checks (review item G5) |
| Server-side request forgery | The egress rules in §3.1 |
| Misconfiguration | No debug output, strict CORS allow-list, security headers on API responses |
| Old or unknown endpoints | A versioned API with a published retirement policy and an inventory |
| Trusting other services blindly | Verify every incoming webhook signature and timestamp; validate everything received from gateways, brokers and Meta |

Specific to this product:
- **Idempotency keys** on every write, so a retry cannot double-book or double-charge.
- **Incoming webhooks:** signature check, a 5-minute timestamp window, a store of seen event ids,
  and replay from the store.
- **Outgoing webhooks:** signed, with retries and a delivery log.
- **The broker XML endpoint:** XML parsing with external entities and entity expansion switched
  off, strict size limits, and a schema check. This blocks the classic XML attacks.
- **Connected cars:** a command such as "unlock" is allowed only during an active rental, for that
  vehicle, from a verified person, and is always logged.

### 3.7 Data protection

- **Encryption:** in transit everywhere; at rest for the database, backups and buckets;
  field-level for licence and ID numbers with keys per workspace held in a KMS (review item G8).
- **ID documents:** private storage, signed links that expire in minutes, every view logged,
  deletion on schedule. Never accepted in chat (already decided).
- **Card data:** hosted fields only. The app never sees a card number.
- **Backups:** encrypted, stored in the same region as the data, restore tested every quarter,
  with stated recovery targets.
- **Logs:** no personal data, no secrets, no tokens. Access to production data by staff is
  time-limited, approved and logged.
- **Data leaving the system:** exports need a permission and step-up confirmation, and large
  exports raise an alert.

### 3.8 AI and agents

In addition to the controls in the architecture (§9):
- treat every customer message, upload and web page as untrusted text that cannot give
  instructions;
- tools limited to the verified customer's own records;
- limits on messages and cost per conversation, per customer and per workspace;
- tell customers when they are talking to an AI, and offer a person;
- test each agent against prompt-injection attempts before every release.

### 3.9 Detection and response

- **Central logging and alerting** on: failed sign-ins, permission denials, row-level-security
  errors, mass reads or exports, new API keys, changed payout details, firewall blocks.
- **An audit trail that cannot be edited** (the audit log is already insert-only for the app role).
- **An incident response plan:** who is on call, how to contain, how to tell customers, and the
  notification deadlines in each country **(verify each)**.
- **A way for researchers to report problems:** a `security.txt` file and a disclosure policy. A
  paid bug bounty can follow.
- **Independent penetration tests** before the pilot, before general availability, then yearly and
  after major changes.

### 3.10 Compliance

| Area | What applies |
| --- | --- |
| Cards | PCI DSS at the lightest level (SAQ A), because card entry is hosted by the gateway. Confirm the current rules on scripts on payment pages **(verify)** |
| Company assurance | SOC 2 Type II, then ISO 27001. Insurers, brokers and corporate customers will ask for one of them |
| Privacy, US | State privacy laws (California and others) and the Driver's Privacy Protection Act for licence data |
| Privacy, Gulf | UAE PDPL, Qatar PDPPL, Oman PDPL, including transfer rules and data-subject requests |
| Privacy, visitors | GDPR and UK GDPR can apply to European tourists' data **(verify with counsel)** |
| Messaging | US: TCPA consent and quiet hours for texts, CAN-SPAM for email. Meta's WhatsApp Business policies |
| Signatures | US ESIGN and UETA; the UAE, Qatar and Oman electronic transactions laws **(verify)** |
| Tax | UAE and Oman VAT invoices and e-invoicing |
| Accessibility | WCAG 2.1 AA (already the target) |
| Vendors | A written agreement and a security review for every outside service that touches personal data, listed per region |
| People | Company SSO with MFA, managed devices, security training, access removed on departure |

---

## 4. Priority order

**Now (before any car work ships).**
1. CDN and firewall in front of the app and the marketing site, with rate limits and cached 404s.
2. Database timeouts and pool limits.
3. Error tracking and alerting.
4. MFA for owners, admins and platform admins.
5. Full Content-Security-Policy and HSTS.
6. Dependency, secret and static scanning in CI.
7. SPF, DKIM and DMARC at reject.

**Before the pilot.**
1. Redis-backed limits per user, workspace and API key.
2. Turnstile on app forms and OTP sending.
3. Payment webhooks with signature checks.
4. KMS keys and field-level encryption for ID data.
5. Direct uploads with scanning and per-type access.
6. Egress controls.
7. Step-up confirmation and passkeys.
8. A tested restore.
9. The first penetration test.
10. An incident response plan and `security.txt`.

**Before general availability.**
1. API security set complete (OAuth, quotas, idempotency, webhook signing).
2. SSO for larger customers and partners.
3. Central alerting on the events in §3.9.
4. SOC 2 Type II audit period started.
5. Second penetration test.
6. Vendor list and agreements per region.
