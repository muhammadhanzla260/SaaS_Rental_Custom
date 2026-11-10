# Market reference data: real-world terms, pain points and reference cases

Status: research notes, 10 Nov 2026. This replaces the "pilot booking records" we don't have yet.

**What this is:** published terms and prices from operators' own pages, consumer-law coverage,
community and consumer reviews, and industry articles. They are used to:
1. set **preset defaults** (booking-flow §5.4);
2. define **reference cases** (the behaviour the engine must produce);
3. rank **pain points** the product must solve.

**What this is not:** real booking records. Public sources give policies and prices, not
transactions.
- Pricing golden cases from real contracts still come from pilot operators once onboarded (D7).
- Sources disagree on many values, and operator pages are marketing. Every number below is a
  **configurable default**, never a hard-coded rule.
- Legal points marked (verify) need confirming with the authority or a lawyer.
- Reddit, Instagram, Facebook and YouTube content could only be reached through search snippets and
  mirrors (no logged-in access), and no Crunchbase pages surfaced. Coverage of those sources is thin
  and noted where used.

---

## 1. Values by market (feeding presets)

### 1.1 UAE (Dubai / Sharjah)

| Item | Observed values | Preset default (editable) |
| --- | --- | --- |
| Daily km allowance | 250 km/day typical. Monthly 4,500–5,000 km | 250 km/day; 4,500 km/month |
| Excess km | AED 0.50–1.00/km (economy, one source); AED 10–45/km (luxury and sports); a court upheld Dh10/km + VAT | By class: economy AED 0.75, SUV 1.00, luxury 10, sports 20 |
| Salik (tolls) | At cost + AED 1 admin per crossing; AED 5 flat per crossing; marked up to AED 5–6. Reported 5% VAT on Salik from 1 Jun 2026 (verify) | Pass-through at cost (from statement) + AED 1 admin per crossing |
| Traffic fine admin fee | AED 20 + 10% of fine; AED 50 flat; AED 50–100. One operator charges AED 500 per black point | AED 50 per fine (no black-point fee by default) |
| Security deposit | AED 1,000–5,000 (SUV 1,500–4,000). Card pre-auth or cash. **No-deposit** offers are common in luxury | By class: economy 1,000, SUV 1,500, luxury 5,000; no-deposit surcharge option |
| Deposit release | 20–21 days at many operators. **30-day maximum** per Dubai DET / DCCPFT (reported as Circular No. 1 of 2024, verify). Deductions must be actual, verifiable costs | Release at 21 days; hard cap 30 days (jurisdiction rule) |
| Insurance excess | AED 1,500–5,000+ by car | By class |
| Delivery | Free over 3 days; or AED 150 flat | Free ≥ 3 days, otherwise AED 150 |
| Documents | Tourists: passport, visa page, home licence (+ IDP depending on licence country), card in driver's name. Residents: Emirates ID + UAE licence | AE jurisdiction pack (list to verify, D9.1) |
| Monthly rental | From about AED 999/month (marketplace listing) | Monthly plan type on |
| Chauffeur | Sedan AED 100–150/h; premium 180–250/h; min 2–5 h; full day AED 700–1,500 | Min 3 h; overtime per 60 min |
| Insurance replacement | 7–15 days; AED 70–100/day approved budget is typical | Insurer account defaults: 10 days, AED 90/day |
| Hourly self-drive (car sharing) | RTA-licensed per-minute (e.g. Dh30/h min), a separate product | Out of scope |

### 1.2 Qatar (Doha)

| Item | Observed values | Preset default |
| --- | --- | --- |
| Visitor licence | Home licence **7 or 14 days** from arrival (sources conflict); IDP up to 3–6 months; temporary Qatari licence after that | QA pack: home licence 7 days (strictest reading) until verified |
| Minimum age | 21 generally; varies by company | 21; young-driver fee under 25 |
| Deposit | QAR 1,000–5,000. Majors QAR 1,500–2,000, or estimated charge + QAR 1,000. Credit card required | QAR 1,500 by default; credit card only |
| Release | Up to 2–4 weeks | 21 days |
| km limits | 200–300 km/day on cheap deals; many unlimited | Unlimited by default; capped plans available |
| Cross-border | Many brands forbid leaving Qatar | Cross-border off |
| VAT | None today (verify) | 0% |

### 1.3 Oman (Muscat)

| Item | Observed values | Preset default |
| --- | --- | --- |
| Age | Minimum 21–25; maximum 70–80. Young-driver fee OMR 3–7/day (21–24/25) | Min 21; young fee OMR 5/day under 25; max 75 |
| Licence | Original physical licence only (no copies or digital). IDP rules depend on licence script (verify) | OM pack |
| Deposit | ~OMR 50 (one guide); varies | OMR 100 |
| km | 200 km/day with OMR 0.070/km excess (one guide); OMR 0.060–0.100 by group; unlimited offers exist | 200 km/day; excess OMR 0.070 (**3-decimal currency**) |
| Additional driver | OMR 2.5–4/day, capped OMR 75–150 | OMR 3/day, cap 100 |
| Airport surcharge | ~OMR 10 | OMR 10 at airport branches |
| Cross-border (UAE → Oman) | Rental company NOC + Oman insurance (Orange Card at the border, from about AED 106); many UAE operators forbid it | Cross-border product off by default; NOC template provided |
| VAT | 5% | 5% |

### 1.4 United States

| Item | Observed values | Preset default |
| --- | --- | --- |
| Minimum age | 20–21 (18 in NY and MI) | By state pack |
| Young-driver fee | $15–40/day (e.g. a $29/day figure at one major); waivers for some memberships | $25/day under 25 |
| Debit cards | Often 25+ only, a bigger hold, and sometimes proof of return travel at airports | Rule preset "US debit card" |
| Deposits | $170–3,000. One independent: $2,000 for local renters unless they buy protection | $250 credit / $500 debit |
| Mileage | e.g. 150 free mi/day + $0.25/mi (a Florida independent); many unlimited | Unlimited by default; capped plans available |
| Grace / late | 29–59 min grace; then hourly up to ~2 h, then a full day; extras often a full day with no grace | 29 min; hourly up to 2 h; extras no grace |
| Card name | Must match the licence | Rule on |

---

## 2. Pain points (what operators and renters complain about)

| # | Pain | Where seen | Product answer |
| --- | --- | --- | --- |
| P1 | **Deposits not released on time**; renters chase for weeks | Gulf News, Reddit (r/dubai snapshots), Trustpilot, DET complaint route | Deposit release timer per jurisdiction cap (30 days in Dubai, verify); an automatic release job; the customer portal shows every deduction with evidence |
| P2 | **Salik and fines charged without proof**; renters follow up 4–5 times | Reddit snapshot, Gulf News | Statement-line evidence (gate, time, plate) on every post-rental charge; itemised statement in the portal; dispute button |
| P3 | **Court disputes over fines and Salik** | Dubai court report (Dh8,735 awarded to a rental company) | Signed consent for post-rental charges and complete evidence packs, export-ready for disputes |
| P4 | **Double bookings** from stale availability (web vs walk-in) | Industry blogs | Authoritative commit under lock (booking-flow §8) and channel allotments |
| P5 | **Spreadsheets and manual bookings** at small operators (one vendor claims 67% still manual in part) | Vendor blogs, template sellers | Fast counter builder, CSV import, presets that work on day one |
| P6 | **Turo hosts:** tolls reimbursed manually, opaque earnings, calendar sync double-bookings, manual claims | Vendor pages, Turo help, ConsumerAffairs | iCal + email import, payout statement import and matching, toll matching across platforms |
| P7 | **Excess km disputes** (a case went to court in Abu Dhabi) | Gulf News | Odometer photo at check-out and check-in, the allowance shown on the agreement, an automatic calculation shown to the customer |
| P8 | **Damage disputes** and AI-scanner backlash | Hertz/UVeye coverage | Evidence-first damage, with a person confirming (architecture §9) |
| P9 | **Hidden fees** perception (admin fees, delivery, Salik markups) | "Hidden fees in Dubai car rental 2026" articles | All fees itemised in the quote before confirm; fee transparency per channel |

---

## 3. Funding and market signals (2026)

- **Sigvi**, an AI revenue-management platform for car rental, raised a pre-seed round in 2026.
  Most sources say €1.2M; one headline says €12M. The conflict is unresolved. Either way, it is a
  signal that **AI yield and pricing for rental** is getting investment.
- **TripWip**, P2P carsharing in Uruguay, raised a $4.2M seed (Jul 2026) with Toyota and Kia.
- **CarCloud** AI rental agent (Mar 2026) and **Point of Rental** phone agent (Mar 2026). The agent
  layer is now a product category.
- **OneClickDrive** expanded its chauffeur and luxury suppliers (Aug 2026) and its monthly packages
  in Dubai.
- **Latka** (Jun 2026) lists 26 car-rental SaaS companies with $214.6M raised combined; Vulog is the
  largest at $64.1M. This is a small, fragmented software market, and there is room for a modern
  entrant.

---

## 4. Reference cases (expected behaviour, before real pilot data)

Each case is a **rule-bench test** (booking-flow §4.3) that the presets must pass. Expected
outcomes cover the rules that fire, documents and gates, fees, deposit and allowances, **not** exact
totals. Exact totals come from pilot golden cases later.

| # | Preset | Input | Expected |
| --- | --- | --- | --- |
| R1 | Dubai standard | Visitor, UK licence, 30 y, economy, 4 days, Marina hotel delivery | Passport + visa/entry stamp + home licence required **by hand-over** (IDP only if the AE list says so); delivery free (≥ 3 days); 250 km/day = 1,000 km; deposit AED 1,000; VAT 5% inclusive display |
| R2 | Dubai standard | Resident, Emirates ID + UAE licence, SUV, 2 days | Emirates ID + UAE licence by hand-over; delivery AED 150; deposit AED 1,500 |
| R3 | Dubai luxury | Visitor, 23 y, Lamborghini (vehicle level) | **Approval** required (under 25 + luxury); the vehicle is held as a specific VIN at hold; deposit AED 5,000 or no-deposit surcharge |
| R4 | Dubai standard | Return 1 h 10 min late, with child seat | Grace 29 min passed → hourly charge for the car; child seat charged a full extra day (no grace) |
| R5 | Dubai standard | 3 Salik crossings and 1 fine 12 days after return | Matched to the agreement; 3 × (cost + AED 1) + fine + AED 50 admin; taken from the retained deposit; release on day 21; evidence in the portal |
| R6 | Dubai standard | Customer sends Emirates ID photo on WhatsApp | Not stored; secure upload link sent (platform guardrail) |
| R7 | Monthly UAE | Resident, 1 month, 5,200 km driven | 4,500 km included → 700 km excess at the class rate; next cycle auto-charged |
| R8 | Dubai standard | UAE → Oman requested, economy | Cross-border off → offer restricted with a message. With it enabled: NOC generated + insurance add-on required by hand-over |
| R9 | Doha | Visitor, home licence, arriving 10 days before pickup | Strict 7-day reading → IDP or temporary licence required (flagged "verify rule") |
| R10 | Muscat | 22 y, compact, 3 days, 750 km | Young fee OMR 5 × 3; 600 km included, 150 km × OMR 0.070 = **OMR 10.500** (3 decimals) |
| R11 | US airport | 22 y, debit card, Florida | Young fee $25/day; debit rule: 25+ only → **deny** (or approval, per tenant) |
| R12 | US neighborhood | 30 y, credit card, name doesn't match licence | Card-name rule → blocked at Gate B until a matching card is used |
| R13 | Chauffeur (Dubai) | 4 h booked, 5 h 20 min used, 25 min waiting | 3 h minimum met; overtime 2 × 60-min blocks (rounded up per setting); waiting within free 30 min; no driver KYC required |
| R14 | Insurance replacement (UAE) | Insurer authorises 10 days at AED 90, customer keeps 12 days, upgrades a class | Insurer invoice: 10 × AED 90. Customer invoice: 2 extra days + upgrade difference + Salik + fuel |
| R15 | Broker (prepaid) | Discover Cars voucher, prepaid rental, customer adds child seat at desk | Bill-to broker for rental (net); customer pays seat + deposit at desk; broker receivable in the ledger |
| R16 | Turo import (US) | iCal block + booking email for a VIN | Vehicle blocked; reservation with channel=turo, bill-to platform; no duplicate on resend |

---

## Sources

**UAE terms and prices**
- [Dollar UAE: monthly car rental costs 2026](https://blog.dollaruae.com/monthly-car-rental-costs-dubai-2026/)
- [Saadat: hidden fees in Dubai car rental 2026](https://saadatrent.ae/mag/hidden-fees-in-dubai-car-rental/)
- [RentDrive: rental conditions](https://rentdrive.ae/rental-conditions/)
- [Dubai Small: conditions](https://dubai-small.com/en/conditions)
- [PB Rent a Car: FAQs](https://pbrentacar.ae/car-rental-dubai-questions) · [PB: Salik](https://pbrentacar.ae/is-salik-included-car-rental-dubai) · [PB: deposit & fines](https://pbrentacar.ae/car-rental-deposit-and-fines-dubai)
- [Paradise VIP: terms](https://carrentaldubai.com/terms-condition/)
- [Brook Drive: hidden fees](https://brook-drive.rent/hidden-fees-when-renting-a-luxury-car-in-dubai/)
- [Gulf News: Abu Dhabi km-limit fine](https://gulfnews.com/uae/government/abu-dhabi-man-fined-for-driving-twice-the-distance-allowed-in-one-day-car-rental-1.500205880)
- [Gulf News: deposits and the 30-day limit](https://gulfnews.com/living-in-uae/transport/uae-car-rental-deposit-refund-rules-30-days-1.500374258)
- [Gulf News: deposit within 30 days](https://gulfnews.com/living-in-uae/transport/dubai-car-rentals-your-security-deposit-should-be-returned-within-30-days-1.1709647857165)
- [ArabWheels: how deposits work](https://www.arabwheels.ae/blog/how-car-rental-deposits-work-in-the-uae-a-complete-guide/)
- [UAE Expert Hub: deposits](https://www.uaeexperthub.com/car-rental-deposits-uae-refund/)

**UAE disputes and reviews**
- [Law Reporters: court orders renter to pay fines and Salik](https://thelawreporters.com/vehicle-renter-traffic-fines-salik-case-uae)
- [Reddit snapshot (r/dubai)](https://reddit.sentinel-team.org/posts/1rbtsqx/snapshots/2026-02-23T17%3A00%3A25.42014Z) · [Reddit snapshot](https://reddit.sentinel-team.org/posts/1sqld2a/snapshots/2026-04-24T18%3A50%3A07.966679Z)
- [Trustpilot: Thrifty UAE](https://ca.trustpilot.com/review/thriftyuae.com)
- [Friends Car Rental: disputes](https://friendscarrental.com/blogs/handle-car-rental-disputes-dubai)

**Chauffeur and hourly**
- [Gulf News: hourly rental](https://gulfnews.com/living-in-uae/transport/dubai-can-i-rent-a-car-for-an-hour-or-two-all-you-need-to-know-about-hourly-vehicle-rental-1.1701255864052)
- [Hourly chauffeur rates guide](https://tourtransfer.pages.dev/blog/hourly-chauffeur-rates)
- [Detailed Drivers: Dubai chauffeur](https://www.detaileddrivers.com/locations/dubai/chauffeur-service)
- [OneClickDrive: chauffeur](https://www.oneclickdrive.com/es/chauffeur-service-dubai/lexus)
- [Gulf Today: OneClickDrive chauffeur suppliers](https://www.gulftoday.ae/business/2026/08/14/oneclickdrive-broadens-its-dubai-chauffeur-and-luxury-rental-supplier-base)

**Insurance replacement**
- [Enterprise: who pays after an accident](https://www.enterprise.com/en/car-rental/rent-a-car-after-an-accident/who-pays.html)
- [Keller: rental after an accident](https://www.2keller.com/rental-car-after-accident/)
- [Viet Auto Collision: card still needed](https://vietautocollision.com/blog/rental-car-after-an-accident-deposit/)
- [Gulf News: replacement car after an accident](https://gulfnews.com/living-in-uae/transport/traffic-accident-in-the-uae-how-to-get-back-on-the-road-with-a-replacement-car-1.500017193)
- [Policybazaar: replacement car cover](https://www.policybazaar.ae/car-insurance/addons-replacement-car-cover)
- [Law Reporters: replacement cars](https://thelawreporters.com/navigating-replacement-cars-after-a-traffic-accident-in-the-uae)
- [ADNIC: motor fleet](https://adnic.ae/motor-fleet-insurance)
- [Patent: replacement rental B2B workflow](https://patents.justia.com/patent/20130218614)

**Qatar and Oman**
- [Europcar Qatar terms (PDF)](https://WWW.EUROPCAR.IT/files/live/sites/Europcar/files/Conf_email_attachment/CGL_EN_QA.pdf)
- [Qatar Living: how to rent a car](https://www.qatarliving.com/en/article/how-rent-car-qatar)
- [Enterprise: Doha The Pearl](https://www.enterprise.com/en/car-rental-locations/qa/doha-the-pearl-kqe3.html)
- [QIC: car rentals in Qatar](https://qic.online/en/blog/cars-bikes/car-rentals-qatar)
- [TripLinkHub: Qatar pitfalls](https://www.triplinkhub.com/en/blog/car-rental-in-qatar-where-to-book-prices-and-hidden-pitfalls)
- [Enterprise: Muscat Airport](https://www.enterprise.com/en/car-rental/locations/oman/muscat-airport-zbe1.html)
- [Europcar Oman terms (PDF)](https://www.europcar.ie/files/live/sites/Europcar/files/Conf_email_attachment/CGL_EN_OM.pdf)
- [Sixt: Oman rental information](https://www.sixt.com/rental-information/om/car/)
- [LNK Oman: IDP](https://www.lnkoman.com/international-driving-permit-oman/)
- [Gulf News: UAE to Oman in a rental car](https://gulfnews.com/living-in-uae/transport/can-i-drive-from-uae-to-oman-in-a-rental-car-all-you-need-to-know-1.1696256324198)

**United States**
- [Thrifty: general policies](https://www.thrifty.com/AboutUs/content/GeneralPolicies.aspx)
- [Economy Rent-A-Car: Fort Lauderdale policies](https://www.economyrentacar.com/policies/ft-lauderdale-car-rental)
- [Budget: debit cards](https://www.budget.com/en/help/usa-faqs/rent-with-debit-card)
- [Upon Arriving: grace periods](https://www.uponarriving.com/rental-car-grace-periods)
- [NerdWallet: under-25 fee](https://www.nerdwallet.com/article/travel/avoided-paying-rental-car-underage-driver-fee)

**Operators, Turo and P2P**
- [Car Rental Solutions: small agencies](https://www.carrentalsolutions.com/blog/choosing-car-rental-software-small-agency/)
- [Coastr: ditching spreadsheets](https://www.coastr.com/post/why-rental-businesses-are-ditching-spreadsheets-for-smart-fleet-management)
- [Levy: calendar sync (Turo, Getaround)](https://fleets.levyelectric.com/help/car-sharing/calendar-sync)
- [VEVS: Turo integration](https://www.vevs.com/turo.php)
- [FleetWire: email forwarding](https://help.fleetwire.io/en/article/set-up-email-forwarding-with-gmail-psmtx)
- [Turo: host help](https://turo.com/us/en/help)
- [ConsumerAffairs: Turo](https://www.consumeraffairs.com/travel/turo.html?page=58)

**Channels**
- [CarTrawler (Wikipedia)](https://en.wikipedia.org/wiki/CarTrawler)
- [XML TravelGate: OTA VehRateRule](https://xml-travelgate-developer-documentation.readthedocs.io/en/latest/car/DSF/rate-rule.html)
- [Carnect: OTA 2007a endpoints](https://doc.carnect.com/ota2007/endpoints.html)
- [OneClickDrive: list your company](https://www.oneclickdrive.com/list-your-car-rental-marketplace/bahrain)
- [Kanal: WhatsApp Flows 2026](https://getkanal.com/blog/whatsapp-flows-guide-ecommerce)
- [Hyperleap: WhatsApp API features 2026](https://hyperleap.ai/whatsapp-business-api/features)
- [Google: vehicle ads overview](https://support.google.com/merchants/answer/11189169)
- [Octane: online booking launch (Khaleej Times)](https://www.khaleejtimes.com/kt-network/octane-rent-launches-first-true-online-car-booking?amp=1)

**Funding and market signals**
- [Tech.eu: Sigvi](https://tech.eu/2026/07/29/sigvi-raises-eur12m-to-expand-automated-car-rental-operations/) · [Startup Researcher: Sigvi €1.2M](https://www.startupresearcher.com/news/ai-car-rental-platform-sigvi-raises-1-2-million-pre-seed-round)
- [SaaSRise: TripWip seed](https://www.saasrise.com/deals/tripwip-raises-42m-seed-round-254dc372-3fe7-46a2-9407-a486ddd616fe)
- [Latka: car rental software](https://getlatka.com/companies/industries/i-car-rental-software)
