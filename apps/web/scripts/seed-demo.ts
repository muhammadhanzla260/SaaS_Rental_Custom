/**
 * Demo data for previewing and QA (local or staging only, never production):
 * the platform owner, Freedom Fun USA (demo) with 4 branches, a full team,
 * catalog, customers and orders, plus five more organizations in every
 * console status. Safe to rerun: the previous demo data is removed first.
 *
 *   pnpm seed:demo
 * Every login uses the password printed at the end.
 */
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { hashPassword } from 'better-auth/crypto';
import {
  addDays, bookingDefaultsSchema, brandSettingsSchema, creditSchema, customerSchema, locationSchema, orderSchema, parsePreferences, productSchema,
  wallTimeToUtc,
} from '@rental/core';
import {
  acceptInvitation, addUnit, createCategory, createCredit, createCustomer, createDb, createInvitation, createLocation, createOrder, createProduct,
  createWorkspace, launchWorkspace, listLocations, markOnboarding, platformCloseOrg, platformSetStatus, saveConnectStep, saveCustomerAddress,
  setProductStatus, setUnitStatus, setupOrganization, transitionOrder, updateBrand, updateMember, updatePreferences, listTeam,
} from '@rental/db';

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });
if (process.env.NODE_ENV === 'production' || /neon\.tech/.test(process.env.DATABASE_URL_OWNER ?? '') && !process.env.ALLOW_DEMO_SEED) {
  console.error('Refusing to seed demo data here. Set ALLOW_DEMO_SEED=1 for a staging database.');
  process.exit(1);
}

const PASSWORD = 'Tentpole-2026!';
const DOMAIN = 'demo.tentpole.test';
// Services run on the restricted app connection (row-level security on), exactly like the app.
// The owner connection only creates logins, flags the platform owner and clears old demo data.
const { db } = createDb(process.env.DATABASE_URL!, { max: 4 });
const { client } = createDb(process.env.DATABASE_URL_OWNER!, { max: 2 });
const appClient = createDb(process.env.DATABASE_URL!, { max: 1 }).client;

const SLUGS = ['freedom-fun-demo', 'summit-tent', 'lakeside-party-rentals', 'bayou-bounce', 'northwind-av', 'old-town-inflatables'];

async function reset() {
  // Leftovers from browser QA runs (e2e-*.mjs): orgs named <name>-<timestamp> and their logins.
  const qa = ['^freedom-fun-demo-[a-z0-9]{8}$', '^party-rentals-[a-z0-9]{8}$', '^lakeside-[a-z0-9]{5}$', '^summit-tent-[a-z0-9]{5}$', '^bayou-bounce-[a-z0-9]{5}$', '^lakeside-party-rentals-[a-z0-9]{5}$'];
  await client`delete from audit_log where tenant_id in (select id from tenants where slug ~ any(${qa}))`;
  await client`delete from tenants where slug ~ any(${qa})`;
  await client`delete from released_slugs where slug ~ any(${qa})`;
  await client`delete from users where email ~ '@(lakeside|tentpole|bayou)\.test$' or email ~ '^(owner|crew|orders)-[a-z0-9]{8}@example\.test$'`;
  await client`delete from audit_log where tenant_id in (select id from tenants where slug = any(${SLUGS}))`;
  await client`delete from tenants where slug = any(${SLUGS})`;
  await client`delete from released_slugs where slug = any(${SLUGS})`;
  await client`delete from users where email like ${'%@' + DOMAIN}`;
}

const hash = await hashPassword(PASSWORD);
async function user(local: string, name: string, platformAdmin = false) {
  const id = randomUUID();
  const email = `${local}@${DOMAIN}`;
  await client`insert into users (id, name, email, email_verified, is_platform_admin) values (${id}, ${name}, ${email}, true, ${platformAdmin})`;
  await client`insert into accounts (id, account_id, provider_id, user_id, password) values (${randomUUID()}, ${id}, 'credential', ${id}, ${hash})`;
  return { id, email, name };
}

const loc = (name: string, code: string, line1: string, city: string, region: string, postalCode: string, lat: number, lng: number, pillColor: string, extra: object = {}) =>
  locationSchema.parse({
    name, code, phone: '(512) 555-0100', address: { line1, city, region, postalCode, country: 'US', lat, lng },
    settings: { pillColor, servedZips: [], ...extra },
  });

async function main() {
  await reset();
  const actorOf = (u: { id: string }) => ({ type: 'user' as const, userId: u.id });

  // --- people ---------------------------------------------------------------------------
  const platform = await user('owner', 'Muhammad Hanzla', true);
  const jordan = await user('jordan', 'Jordan Reyes');
  const staff = {
    alex: await user('alex', 'Alex Kim'),
    priya: await user('priya', 'Priya Nair'),
    sam: await user('sam', 'Sam Ortiz'),
    chris: await user('chris', 'Chris Doyle'),
    morgan: await user('morgan', 'Morgan Lee'),
    riley: await user('riley', 'Riley Chen'),
    kai: await user('kai', 'Kai Jensen'),
  };

  // --- Freedom Fun USA (demo): the design's tenant ---------------------------------------
  const ff = await setupOrganization(db, { userId: jordan.id }, {
    slug: 'freedom-fun-demo', name: 'Freedom Fun USA',
    location: loc('Austin', 'AUS', '9600 Great Hills Trail', 'Austin', 'TX', '78759', 30.3946, -97.7467, '#0B0D12', { servedZips: ['78701', '78702', '78703', '78704', '78759'] }),
    taxPercent: 8.25,
    booking: bookingDefaultsSchema.parse({ depositPercent: 30, cleanupBufferMinutes: 180, damageWaiverPercent: 10, freeTravelDistance: 10 }),
  });
  const ffActor = actorOf(jordan);
  await client`update tenants set legal_name = 'Freedom Fun USA LLC', phone = '+15129815557', email = 'bookings@freedomfunusa.test',
    website = 'https://freedomfunusa.com', status = 'active', plan = 'scale', rollout_phase = 1 where id = ${ff.id}`;
  await updateBrand(db, ff.id, ffActor, {
    branding: { brandColor: '#C2410C', themeMode: 'light', radius: 'round' },
    brand: brandSettingsSchema.parse({ sidebar: 'dark', headingFont: 'friendly', reviewLink: 'https://g.page/r/freedomfun', invoiceFooter: 'Thank you for choosing Freedom Fun USA! Deposits are non-refundable within 7 days of the event; weather cancellations become a rain check valid for 12 months.' }),
  });
  for (const step of ['profile', 'brand', 'warehouse', 'connect', 'team', 'launch'] as const) await markOnboarding(db, ff.id, step, 'done', 5);
  await saveConnectStep(db, ff.id, ffActor, {
    mail: { mode: 'smtp', provider: 'google', host: 'smtp.gmail.com', port: 587, security: 'starttls', username: 'bookings@freedomfunusa.test', password: 'demo-app-password', fromName: 'Freedom Fun USA', fromEmail: 'bookings@freedomfunusa.test' },
    sms: { provider: 'quo', sendingNumber: '+15129815557', apiKey: 'demo-quo-key' },
    payments: { provider: 'ipos', merchantId: '220614981234', secretKey: 'demo-ipos-token' },
  });
  await updatePreferences(db, ff.id, ffActor, 'setupDone', ['numbers', 'rules']);

  const dal = await createLocation(db, ff.id, ffActor, loc('Dallas', 'DAL', '2200 Ross Ave', 'Dallas', 'TX', '75201', 32.7887, -96.7997, '#2C4FE0'), 8.25);
  const hou = await createLocation(db, ff.id, ffActor, loc('Houston', 'HOU', '1001 Avenida de las Americas', 'Houston', 'TX', '77010', 29.7522, -95.3586, '#0B7A55'), 8.25);
  const phx = await createLocation(db, ff.id, ffActor, loc('Phoenix', 'PHX', '100 N 3rd St', 'Phoenix', 'AZ', '85004', 33.4486, -112.0703, '#A85A00', { paused: true }), 8.6);
  const aus = (await listLocations(db, ff.id)).find((l) => l.code === 'AUS')!;

  // Team: every role, with branches and commission like the design's Team screen.
  const join = async (u: { id: string; email: string; name: string }, role: Parameters<typeof createInvitation>[3]['role'], extra: Partial<Parameters<typeof createInvitation>[3]> = {}) => {
    const { token } = await createInvitation(db, ff.id, ffActor, { email: u.email, name: u.name, role, ...extra });
    await acceptInvitation(db, token, { id: u.id, email: u.email });
  };
  await join(staff.alex, 'admin');
  await join(staff.priya, 'manager', { locationIds: [aus.id, dal.id] });
  await join(staff.sam, 'sales', { locationIds: [aus.id], commissionPct: 5 });
  await join(staff.chris, 'coach', { locationIds: [aus.id], vehicle: 'Van 2 · white Transit' });
  await join(staff.kai, 'crew', { locationIds: [aus.id] });
  await join(staff.morgan, 'accountant');
  await join(staff.riley, 'viewer', { locationIds: [phx.id] });
  await createInvitation(db, ff.id, ffActor, { email: `taylor@${DOMAIN}`, name: 'Taylor Brooks', role: 'sales', locationIds: [hou.id], commissionPct: 5 });
  const riley = (await listTeam(db, ff.id)).members.find((m) => m.email === staff.riley.email)!;
  await updateMember(db, ff.id, { ...ffActor, role: 'owner' }, riley.id, { status: 'disabled' });

  // Catalog: the design's sample catalog (Products.dc.html), priced like the Odoo templates:
  // base hours included, then an hourly rate or $25 per 15 minutes.
  const cat = async (name: string) => (await createCategory(db, ff.id, ffActor, name)).id;
  const C = {
    bounce: await cat('Bounce houses'), water: await cat('Water slides'), movie: await cat('Outdoor movie'), food: await cat('Concessions'),
    games: await cat('Games'), tents: await cat('Tents & tables'), fees: await cat('Services & fees'),
  };
  const stock = (aus0: number, more: Record<string, number> = {}) =>
    Object.fromEntries([[aus.id, { owned: aus0 }], ...Object.entries(more).map(([k, v]) => [k, { owned: v }])]);
  const product = (name: string, sku: string, categoryId: string, priceStaffed: number, extra: object = {}) =>
    createProduct(db, ff.id, ffActor, productSchema.parse({ name, sku, categoryId, priceStaffed, baseHours: 4, ...extra }));
  const castle = await product('Castle Bounce House', 'BH-CASTLE', C.bounce, 225, {
    pricePickup: 175, priceDropoff: 195, icon: 'bounce', tint: 'cobalt', inventory: stock(2, { [dal.id]: 1 }),
    locationPrices: [{ locationId: dal.id, mode: 'staffed', price: 240 }],
  });
  const tropical = await product('Tropical Combo Slide', 'BH-TROP', C.bounce, 325, { pricePickup: 275, icon: 'bounce', tint: 'emerald', inventory: stock(1) });
  await product('Princess Palace Bounce', 'BH-PRINC', C.bounce, 235, { pricePickup: 185, icon: 'bounce', tint: 'violet', status: 'draft', inventory: stock(1) });
  const wave = await product('18 ft Wave Water Slide', 'WS-WAVE18', C.water, 375, { pricePickup: 325, icon: 'slide', tint: 'sky', tracking: 'serialized', hourlyRate: 50 });
  const led = await product('LED Screen 12 ft', 'MV-LED12', C.movie, 650, { icon: 'screen', tint: 'ink', tracking: 'serialized', baseHours: 5 });
  await product('Inflatable Screen 16 ft', 'MV-INF16', C.movie, 350, { pricePickup: 300, icon: 'screen', tint: 'navy', inventory: stock(2) });
  const popcorn = await product('Popcorn Machine', 'CN-POP', C.food, 75, { kind: 'addon', pricePickup: 60, priceDropoff: 60, icon: 'food', tint: 'amber', inventory: stock(3) });
  const cotton = await product('Cotton Candy Machine', 'CN-COT', C.food, 75, { kind: 'addon', pricePickup: 60, icon: 'food', tint: 'rose', inventory: stock(2) });
  const jenga = await product('Giant Jenga', 'GM-JENGA', C.games, 40, { kind: 'addon', pricePickup: 40, icon: 'game', tint: 'slate', inventory: stock(4) });
  const tent = await product('20 × 20 Tent', 'TT-2020', C.tents, 450, { icon: 'tent', tint: 'mist', baseHours: 8, inventory: stock(2) });
  await product('Folding table set (10)', 'TT-TBL10', C.tents, 80, { icon: 'table', tint: 'slate', baseHours: 24, inventory: stock(6) });
  await product('Attendant (per hour)', 'SV-ATTEND', C.fees, 35, { kind: 'service', icon: 'fee', tint: 'emerald', baseHours: 1, hourlyRate: 35 });
  const gen = await product('Generator', 'SV-GEN', C.fees, 95, { kind: 'addon', icon: 'fee', tint: 'mist', inventory: stock(2) });
  await setProductStatus(db, ff.id, ffActor, gen.id, 'archived');
  // Suggested add-ons on the bounce houses (shown on the order screen).
  for (const p of [castle, tropical]) {
    await client`update products set suggested_addon_ids = ${[popcorn.id, cotton.id, jenga.id]}::uuid[] where id = ${p.id}`;
  }
  await addUnit(db, ff.id, ffActor, { productId: led.id, locationId: aus.id, label: 'Screen #1', serial: 'LED-12-001' });
  await addUnit(db, ff.id, ffActor, { productId: led.id, locationId: aus.id, label: 'Screen #2', serial: 'LED-12-002' });
  const waveUnit = await addUnit(db, ff.id, ffActor, { productId: wave.id, locationId: aus.id, label: 'Wave Slide', serial: 'WS-0031' });
  await client`insert into coupons (tenant_id, code, kind, value) values (${ff.id}, 'FALL10', 'percent', 10)`;

  // Customers (Customers.dc.html), with tags, saved places and credits.
  const addr = (line1: string, city: string, postalCode: string, lat: number, lng: number) => ({ line1, city, region: 'TX', postalCode, country: 'US', lat, lng });
  const cedarPark = addr('1890 Ranch Shopping Center', 'Cedar Park', '78613', 30.5049, -97.8203);
  const person = (firstName: string, lastName: string, email: string, phone: string, address: object, source: string, extra: object = {}) =>
    createCustomer(db, ff.id, ffActor, customerSchema.parse({ firstName, lastName, email, phone, address, source, ...extra }));
  const org = (companyName: string, email: string, phone: string, address: object, source: string, extra: object = {}) =>
    createCustomer(db, ff.id, ffActor, customerSchema.parse({ kind: 'organization', companyName, email, phone, address, source, ...extra }));
  const maria = await person('Maria', 'Gonzalez', 'maria@example.com', '512-555-0142', cedarPark, 'Google search', { phoneSecondary: '512-555-0198' });
  const oakHill = await org('Oak Hill Elementary', 'pta@example.org', '512-555-0110', addr('6101 Patton Ranch Rd', 'Austin', '78735', 30.2408, -97.8669), 'Referral', { tags: ['School'], taxExempt: true });
  const priya = await person('Priya', 'Shah', 'priya@example.com', '737-555-0123', addr('2400 E Cesar Chavez St', 'Austin', '78702', 30.2556, -97.7175), 'Instagram');
  const lakeway = await org('Lakeway HOA', 'events@example.org', '512-555-0177', addr('1937 Lohmans Crossing', 'Lakeway', '78734', 30.3632, -97.9798), 'Referral', { tags: ['VIP'] });
  const jason = await person('Jason', 'Lee', 'jason@example.com', '512-555-0165', addr('500 E Whitestone Blvd', 'Cedar Park', '78613', 30.5274, -97.8115), 'Repeat customer');
  const craft = await org('Austin Craft Fair', 'ops@example.org', '512-555-0188', addr('2100 Barton Springs Rd', 'Austin', '78704', 30.264, -97.7713), 'Google search', { tags: ['VIP'] });
  const home = await saveCustomerAddress(db, ff.id, ffActor, maria.id, { label: 'Home · Cedar Park', kind: 'event', address: cedarPark });
  await saveCustomerAddress(db, ff.id, ffActor, maria.id, { label: 'Zilker Park', kind: 'event', address: addr('2207 Lou Neff Rd', 'Austin', '78746', 30.2669, -97.7729) });

  // Orders (Austin wall time). The reference order lands on next Saturday.
  const prefs = parsePreferences((await client`select settings from tenants where id = ${ff.id}`)[0]!.settings);
  const today = new Date().toISOString().slice(0, 10);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const sat = addDays(today, ((6 - dow + 7) % 7) || 7);
  type L = { productId: string; quantity?: number; serviceMode?: string };
  const order = async (
    c: { id: string; displayName?: string | null }, date: string, from: string, to: string, lines: L[],
    then: { book?: object | true; quote?: boolean; complete?: boolean } = {}, extra: Record<string, unknown> = {},
  ) => {
    const end = to <= from ? addDays(date, 1) : date;
    const o = await createOrder(db, ff.id, ffActor, orderSchema.parse({
      customerId: c.id, locationId: aus.id, eventType: 'Birthday',
      startsAt: wallTimeToUtc(date, from, 'America/Chicago'), endsAt: wallTimeToUtc(end, to, 'America/Chicago'),
      eventAddress: addr('1100 Congress Ave', 'Austin', '78701', 30.2747, -97.7404), eventMiles: 9.2,
      eventContactName: c.displayName ?? 'On-site contact', eventContactMobile: '512-555-0199', contactConfirmed: true,
      salespersonUserId: staff.sam.id,
      lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity ?? 1, serviceMode: l.serviceMode ?? 'staffed' })),
      ...extra,
    }), prefs);
    if (then.quote) await transitionOrder(db, ff.id, ffActor, o.id, 'send_quote', prefs);
    if (then.book) {
      // Payments follow the real order: the deposit, or everything for past events.
      const b = then.book as { method?: string; amount?: 'deposit' | 'full' } | true;
      const booking = b === true ? undefined
        : b.method === 'manual' ? { ...b, amount: (b.amount === 'full' ? o.totalCents : o.depositDueCents) / 100 } : b;
      await transitionOrder(db, ff.id, ffActor, o.id, 'book', prefs, booking ? { booking: booking as never } : {});
    }
    if (then.complete) await transitionOrder(db, ff.id, ffActor, o.id, 'complete', prefs);
    return o;
  };
  const paid = (amount: 'deposit' | 'full', payMethod = 'other') => ({ method: 'manual', payMethod, amount, reference: 'Demo' });

  // History first, so Maria, Jason and the HOA are repeat customers with lifetime value.
  await order(maria, addDays(today, -133), '13:00', '17:00', [{ productId: castle.id }], { book: paid('full', 'cash'), complete: true });
  await order(maria, addDays(today, -385), '12:00', '16:00', [{ productId: tropical.id }], { book: paid('full', 'check'), complete: true });
  await order(jason, addDays(today, -60), '15:00', '19:00', [{ productId: castle.id }], { book: paid('full', 'zelle'), complete: true });
  await order(lakeway, addDays(today, -40), '10:00', '15:00', [{ productId: tent.id, quantity: 2 }], { book: paid('full', 'ach'), complete: true }, { eventType: 'HOA or community' });
  await order(lakeway, addDays(today, -95), '10:00', '14:00', [{ productId: castle.id }, { productId: jenga.id, quantity: 2 }], { book: paid('full', 'check'), complete: true }, { eventType: 'HOA or community' });
  const rainedOut = await order(maria, addDays(today, -170), '13:00', '17:00', [{ productId: castle.id }], {});
  await transitionOrder(db, ff.id, ffActor, rainedOut.id, 'cancel', prefs, { reason: 'Rained out' });

  // Credits for Maria: a rain check from the rained-out party and $20 goodwill in her wallet.
  await createCredit(db, ff.id, ffActor, maria.id, creditSchema.parse({ kind: 'rain_check', amount: 185.43, reason: 'Event rained out', validUntil: addDays(today, 240) }), rainedOut.id);
  await createCredit(db, ff.id, ffActor, maria.id, creditSchema.parse({ kind: 'wallet', amount: 20, reason: 'Goodwill · Sam Ortiz' }));

  // This week and next: the design's calendar.
  await order(maria, sat, '13:00', '18:00', [{ productId: castle.id }, { productId: popcorn.id }], { book: paid('deposit', 'check') }, {
    customerAddressId: home.id, eventAddress: cedarPark, eventMiles: 18.4, eventLocationName: 'Back yard',
  });
  await order(oakHill, sat, '11:00', '16:00', [{ productId: castle.id }, { productId: jenga.id, quantity: 2 }], {
    book: { method: 'none', reason: 'Mailed check expected', expectedOn: addDays(sat, -2), notes: 'PTA treasurer mails the check Monday.' },
  }, { eventType: 'School or church', eventMiles: 12.6 });
  await order(lakeway, sat, '10:00', '15:00', [{ productId: wave.id }], { book: paid('deposit', 'check') }, { eventType: 'HOA or community', eventMiles: 22.1 });
  await order(craft, addDays(sat, 5), '18:00', '22:00', [{ productId: led.id }, { productId: popcorn.id, quantity: 2 }], { book: paid('deposit', 'ach') }, { eventType: 'Movie night', eventMiles: 4.2 });
  await order(jason, addDays(sat, 3), '15:00', '19:00', [{ productId: castle.id }], { book: paid('deposit', 'venmo') }, { eventMiles: 14.8 });
  await order(craft, addDays(sat, -2), '09:00', '17:00', [{ productId: tent.id, quantity: 2 }], { book: paid('deposit', 'ach') }, { eventType: 'Company or team', eventMiles: 3.1 });
  await order(priya, sat, '14:00', '18:00', [{ productId: tropical.id }], { quote: true }, { eventMiles: 6.4 });
  await order(priya, addDays(sat, 6), '17:00', '21:00', [{ productId: popcorn.id }, { productId: cotton.id }], { quote: true }, { eventType: 'Other', eventMiles: 6.4 });
  await order(jason, addDays(sat, 14), '12:00', '16:00', [{ productId: castle.id, serviceMode: 'pickup' }], {}, { eventMiles: 14.8 });
  // The wave slide's only unit goes in for repair after it was booked: Inventory flags the clash.
  await setUnitStatus(db, ff.id, ffActor, waveUnit.id, 'maintenance', 'Seam leak on the left lane');

  // --- other organizations for the console: every status ----------------------------------
  const other = async (local: string, name: string, slug: string, status: 'active' | 'trial', plan: 'starter' | 'growth' | 'scale', progress: number) => {
    const u = await user(local, name.split(' ')[0] + ' Owner');
    const t = await createWorkspace(db, { userId: u.id }, { name, slug, country: 'US', plan, status });
    const steps = ['profile', 'brand', 'warehouse', 'connect', 'team', 'launch'] as const;
    for (const s of steps.slice(0, progress)) await markOnboarding(db, t.id, s, 'done', Math.min(5, progress));
    if (progress >= 6) await launchWorkspace(db, t.id, actorOf(u), plan);
    return t;
  };
  await other('avery', 'Summit Tent & Event', 'summit-tent', 'active', 'growth', 6);
  await other('jordanr', 'Lakeside Party Rentals', 'lakeside-party-rentals', 'trial', 'growth', 5);
  const bayou = await other('casey', 'Bayou Bounce Co.', 'bayou-bounce', 'active', 'starter', 6);
  await client`update tenants set status = 'past_due' where id = ${bayou.id}`;
  const northwind = await other('drew', 'Northwind AV Rentals', 'northwind-av', 'trial', 'growth', 4);
  await platformSetStatus(db, platform.id, northwind.id, 'suspended');
  const oldTown = await other('robin', 'Old Town Inflatables', 'old-town-inflatables', 'trial', 'starter', 1);
  await platformCloseOrg(db, platform.id, oldTown.id, 'old-town-inflatables');

  console.log(`
Demo data ready. Password for every login: ${PASSWORD}

  Platform owner (console)  ${platform.email}
  Freedom Fun owner         ${jordan.email}       → /freedom-fun-demo
  Admin                     ${staff.alex.email}
  Manager (AUS, DAL)        ${staff.priya.email}
  Sales (AUS, 5%)           ${staff.sam.email}
  Coach                     ${staff.chris.email}
  Accountant                ${staff.morgan.email}
  Viewer (disabled)         ${staff.riley.email}
`);
}

let code = 0;
try {
  await main();
} catch (e) {
  console.error('Seeding failed:', e);
  code = 1;
} finally {
  await client.end();
  await appClient.end();
  process.exit(code);
}
